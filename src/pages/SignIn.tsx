import { useState } from 'react';
import { readStoredCredentials, storeStateRepo } from '../lib/session';
import { oauthConfigured, startGitHubSignIn } from '../lib/oauth';
import { parseRepo } from '../lib/github';
import { ErrorBox, Field } from '../components/ui';

export function SignIn({ initialError }: { initialError?: unknown }) {
  const stored = readStoredCredentials();
  const [stateRepo, setStateRepo] = useState(stored.stateRepo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(initialError ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const repo = stateRepo.trim();
    if (!parseRepo(repo)) {
      setError(new Error('Workspace must look like "owner/name".'));
      return;
    }
    setBusy(true);
    try {
      storeStateRepo(repo);
      await startGitHubSignIn(repo); // navigates away to GitHub
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card signin" onSubmit={submit}>
        <div className="brand brand-large">
          <span className="brand-mark">{'{ }'}</span> Contract Hub
        </div>
        <p className="muted">Browse and edit the OpenAPI and AsyncAPI contracts in your GitHub repositories.</p>
        <Field label="Workspace (state repository)" hint="The repository that stores the project list and permissions, e.g. my-org/contract-hub-state.">
          <input value={stateRepo} onChange={(e) => setStateRepo(e.target.value)} placeholder="owner/name" required />
        </Field>
        {!oauthConfigured && (
          <ErrorBox error="Sign in with GitHub is not configured. Set VITE_GITHUB_CLIENT_ID and VITE_OAUTH_EXCHANGE_URL (see README)." />
        )}
        {error != null && <ErrorBox error={error} />}
        <button className="btn btn-primary btn-block" disabled={busy || !oauthConfigured}>
          {busy ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
        </button>
      </form>
    </div>
  );
}
