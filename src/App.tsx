import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { HashRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { GitHub, type RepoRef } from './lib/github';
import { SessionProvider, clearCredentials, readStoredCredentials, signIn, storeCredentials, useSession, type User } from './lib/session';
import { completeGitHubSignIn, revokeGitHubToken } from './lib/oauth';
import { SignIn } from './pages/SignIn';
import { Projects } from './pages/Projects';
import { ProjectOverview } from './pages/ProjectOverview';
import { Admin } from './pages/Admin';
import { ErrorBox, Spinner } from './components/ui';

// The editor is the heaviest part of the app; load it on demand.
const ContractEditorPage = lazy(() => import('./pages/ContractEditorPage').then((m) => ({ default: m.ContractEditorPage })));

interface Auth {
  gh: GitHub;
  user: User;
  repo: RepoRef;
}

export function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [signInError, setSignInError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Returning from GitHub's consent page?
      let fresh: { token: string; stateRepo: string } | null = null;
      try {
        fresh = await completeGitHubSignIn();
      } catch (e) {
        if (!cancelled) setSignInError(e);
        return;
      }
      const { token, stateRepo } = fresh ?? readStoredCredentials();
      if (!token || !stateRepo) return;
      try {
        const result = await signIn(token, stateRepo);
        if (cancelled) return;
        storeCredentials(token, stateRepo);
        setAuth(result);
      } catch (e) {
        if (cancelled) return;
        clearCredentials();
        if (fresh) setSignInError(e);
      }
    })().finally(() => !cancelled && setRestoring(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(() => {
    revokeGitHubToken(readStoredCredentials().token);
    clearCredentials();
    setAuth(null);
  }, []);

  if (restoring) return <div className="center-page"><Spinner label="Signing in…" /></div>;
  if (!auth) return <SignIn initialError={signInError} />;

  return (
    <SessionProvider gh={auth.gh} user={auth.user} stateRepo={auth.repo} onSignOut={signOut}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SessionProvider>
  );
}

function Shell() {
  const { user, isAdmin, signOut, stateRepo } = useSession();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">{'{ }'}</span> Contract Hub
        </Link>
        <nav>
          <NavLink to="/" end>Projects</NavLink>
          {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="topbar-user">
          <img src={user.avatarUrl} alt="" />
          <span title={`State: ${stateRepo.owner}/${stateRepo.repo}`}>{user.login}</span>
          <span className={`role ${isAdmin ? 'role-admin' : ''}`}>{isAdmin ? 'admin' : 'member'}</span>
          <button className="btn btn-ghost btn-small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="content">
        <StateGate>
          <Routes>
            <Route path="/" element={<Projects />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/p/:owner/:repo" element={<ProjectOverview />} />
            <Route path="/p/:owner/:repo/edit" element={<Suspense fallback={<Spinner />}><ContractEditorPage /></Suspense>} />
            <Route path="*" element={<p>Page not found. <Link to="/">Back to projects</Link></p>} />
          </Routes>
        </StateGate>
      </main>
    </div>
  );
}

function StateGate({ children }: { children: React.ReactNode }) {
  const { appState, reload, initialize, stateRepo, user } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (appState.status === 'loading') return <Spinner label="Loading workspace…" />;
  if (appState.status === 'error') return <ErrorBox error={appState.error} onRetry={reload} />;
  if (appState.status === 'missing') {
    return (
      <div className="card narrow">
        <h1>Set up Contract Hub</h1>
        <p>
          The state repository <code>{stateRepo.owner}/{stateRepo.repo}</code> has no <code>contract-hub.json</code> yet.
        </p>
        {appState.canInitialize ? (
          <>
            <p>Initializing creates it and makes you (<strong>{user.login}</strong>) the first admin.</p>
            {err != null && <ErrorBox error={err} />}
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await initialize();
                } catch (e) {
                  setErr(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Initializing…' : 'Initialize workspace'}
            </button>
          </>
        ) : (
          <p>Ask someone with write access to that repository to initialize it.</p>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
