// "Sign in with GitHub" via GitHub's OAuth web flow, with PKCE and a `state` check.
// The code-for-token exchange happens in auth-worker/ (it needs the OAuth App's client secret).

const CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined) ?? '';
const EXCHANGE_URL = ((import.meta.env.VITE_OAUTH_EXCHANGE_URL as string | undefined) ?? '').replace(/\/+$/, '');
const PENDING_KEY = 'contract-hub.oauth-pending';
// `repo` covers reading/writing contracts, branches, PRs and inviting collaborators on repos the user can access.
const SCOPES = 'repo';

export const oauthConfigured = Boolean(CLIENT_ID && EXCHANGE_URL);

interface Pending {
  state: string;
  verifier: string;
  stateRepo: string;
  returnTo: string;
}

/** Where GitHub sends the user back to: the app's own page, without query or hash. */
function redirectUri() {
  return window.location.origin + window.location.pathname;
}

function randomString(bytes: number) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Redirects to GitHub's consent page. */
export async function startGitHubSignIn(stateRepo: string) {
  if (!oauthConfigured) throw new Error('Sign in with GitHub is not configured (VITE_GITHUB_CLIENT_ID / VITE_OAUTH_EXCHANGE_URL).');
  const pending: Pending = {
    state: randomString(32),
    verifier: randomString(48), // 64 chars, within PKCE's 43–128
    stateRepo,
    returnTo: window.location.hash,
  };
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier)));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state: pending.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    allow_signup: 'false',
  });
  window.location.assign(`https://github.com/login/oauth/authorize?${params}`);
}

let callback: Promise<{ token: string; stateRepo: string } | null> | null = null;

/**
 * If the page was loaded as GitHub's OAuth callback (`?code=…&state=…`), finishes sign-in and returns the token.
 * Returns null on a normal page load. Memoized, so React StrictMode's double effects don't redeem the code twice.
 */
export function completeGitHubSignIn() {
  callback ??= (async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (!code && !error) return null;

    let pending: Pending | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    // Remove the code from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname + (pending?.returnTo ?? window.location.hash));

    if (error) {
      throw new Error(error === 'access_denied' ? 'Sign-in was cancelled on GitHub.' : params.get('error_description') ?? error);
    }
    if (!pending || pending.state !== params.get('state')) {
      throw new Error('Sign-in could not be verified. Please try again.');
    }

    const res = await fetch(`${EXCHANGE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: pending.verifier, redirect_uri: redirectUri() }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(`GitHub sign-in failed: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
    }
    return { token: data.access_token, stateRepo: pending.stateRepo };
  })();
  return callback;
}

/** Revokes the token at GitHub (best effort, used on sign-out). */
export function revokeGitHubToken(token: string) {
  if (!oauthConfigured || !token) return;
  void fetch(`${EXCHANGE_URL}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token }),
    keepalive: true,
  }).catch(() => undefined);
}
