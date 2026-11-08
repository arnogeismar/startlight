// Contract Hub OAuth helper: the only server-side piece of the app.
//
// GitHub's OAuth web flow ends with exchanging a one-time `code` for an access token, which needs the
// OAuth App's client secret. A static site cannot hold a secret, so this Worker does that one step.
// It stores nothing and logs nothing: code in, token out.
//
//   POST /token   { code, code_verifier, redirect_uri }  ->  { access_token, scope, token_type }
//   POST /revoke  { access_token }                       ->  204   (used by "Sign out")
//
// Configuration (see auth-worker/README.md):
//   vars:    GITHUB_CLIENT_ID, ALLOWED_ORIGINS (comma-separated, e.g. "https://acme.github.io,http://localhost:5173")
//   secrets: GITHUB_CLIENT_SECRET

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (!allowed.includes(origin)) return json({ error: 'origin_not_allowed' }, 403);

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: 'worker_not_configured' }, 500, cors);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_request' }, 400, cors);

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path === '/token') return exchange(body, env, origin, cors);
    if (path === '/revoke') return revoke(body, env, cors);
    return json({ error: 'not_found' }, 404, cors);
  },
};

async function exchange(body, env, origin, cors) {
  const { code, code_verifier, redirect_uri } = body;
  const valid =
    isStr(code, 1, 128) &&
    isStr(code_verifier, 43, 128) &&
    isStr(redirect_uri, 1, 2048) &&
    // The token must only ever be handed to the origin that asked for it.
    (redirect_uri === origin || redirect_uri.startsWith(origin + '/'));
  if (!valid) return json({ error: 'invalid_request' }, 400, cors);

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'contract-hub-auth' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier,
      redirect_uri,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data || typeof data.access_token !== 'string') {
    return json({ error: data?.error ?? 'exchange_failed', error_description: data?.error_description }, 400, cors);
  }
  return json({ access_token: data.access_token, scope: data.scope, token_type: data.token_type }, 200, cors);
}

async function revoke(body, env, cors) {
  if (!isStr(body.access_token, 1, 512)) return json({ error: 'invalid_request' }, 400, cors);
  // Deleting an app authorization needs the client secret; holding the token only lets you revoke that token.
  await fetch(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`),
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'contract-hub-auth',
    },
    body: JSON.stringify({ access_token: body.access_token }),
  });
  return new Response(null, { status: 204, headers: cors });
}

function isStr(v, min, max) {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
