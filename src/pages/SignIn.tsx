import { useState } from 'react';
import { readStoredCredentials, signIn, storeCredentials } from '../lib/session';
import { ErrorBox, Field } from '../components/ui';
import type { GitHub, RepoRef } from '../lib/github';
import type { User } from '../lib/session';

export function SignIn({ onSignedIn }: { onSignedIn: (a: { gh: GitHub; user: User; repo: RepoRef }) => void }) {
  const stored = readStoredCredentials();
  const [token, setToken] = useState('');
  const [stateRepo, setStateRepo] = useState(stored.stateRepo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(token.trim(), stateRepo.trim());
      storeCredentials(token.trim(), stateRepo.trim());
      onSignedIn(result);
    } catch (err) {
      setError((err as { status?: number }).status === 401 ? new Error('GitHub rejected that token.') : err);
    } finally {
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
        <Field
          label="GitHub personal access token"
          hint="Fine-grained token with Contents + Pull requests (read & write) and Metadata (read) on the repos you work with. Stored only in this browser."
        >
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" required autoFocus />
        </Field>
        <Field label="Workspace (state repository)" hint="The repository that stores the project list and permissions, e.g. my-org/contract-hub-state.">
          <input value={stateRepo} onChange={(e) => setStateRepo(e.target.value)} placeholder="owner/name" required />
        </Field>
        {error != null && <ErrorBox error={error} />}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <a
          className="small"
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
        >
          Create a token on GitHub →
        </a>
      </form>
    </div>
  );
}
