import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { repoKey } from '../lib/github';
import { ErrorBox, EmptyState } from '../components/ui';

export function Admin() {
  const { gh, state, isAdmin, updateState, user, stateRepo } = useSession();
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!isAdmin) return <EmptyState title="Admins only">You don't have admin rights in this workspace.</EmptyState>;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const addAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    const who = login.trim().replace(/^@/, '');
    void run(async () => {
      if (!(await gh.userExists(who))) throw new Error(`GitHub user "${who}" does not exist.`);
      await updateState(`Make ${who} an admin`, (s) => {
        if (!s.admins.some((a) => a.toLowerCase() === who.toLowerCase())) s.admins.push(who);
        return s;
      });
      setLogin('');
    });
  };

  const removeAdmin = (who: string) => {
    if (who.toLowerCase() === user.login.toLowerCase() && !confirm('Remove your own admin rights?')) return;
    void run(() =>
      updateState(`Remove ${who} as admin`, (s) => {
        const admins = s.admins.filter((a) => a.toLowerCase() !== who.toLowerCase());
        if (!admins.length) throw new Error('There must be at least one admin.');
        return { ...s, admins };
      }),
    );
  };

  const users = new Map<string, string[]>();
  for (const p of state.projects) for (const e of p.editors) users.set(e, [...(users.get(e) ?? []), `${p.owner}/${p.repo}`]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Admin</h1>
          <p className="muted">
            Workspace state lives in <a href={`https://github.com/${stateRepo.owner}/${stateRepo.repo}/blob/HEAD/contract-hub.json`} target="_blank" rel="noreferrer"><code>{stateRepo.owner}/{stateRepo.repo}/contract-hub.json</code></a>. Every change is a commit there.
          </p>
        </div>
      </div>
      {error != null && <ErrorBox error={error} />}

      <section className="card">
        <h3>Admins</h3>
        <p className="muted small">Admins can add and remove projects, manage editors and edit every contract. They also need write access to the state repository.</p>
        <ul className="user-list">
          {state.admins.map((a) => (
            <li key={a}>
              <img src={`https://github.com/${a}.png?size=48`} alt="" />
              <a href={`https://github.com/${a}`} target="_blank" rel="noreferrer">{a}</a>
              <button className="btn btn-small btn-danger-ghost" disabled={busy || state.admins.length < 2} onClick={() => removeAdmin(a)}>Remove</button>
            </li>
          ))}
        </ul>
        <form className="row gap-s" onSubmit={addAdmin}>
          <input placeholder="GitHub username" value={login} onChange={(e) => setLogin(e.target.value)} disabled={busy} />
          <button className="btn btn-primary" disabled={busy || !login.trim()}>Add admin</button>
        </form>
      </section>

      <section className="card">
        <h3>Edit rights by project</h3>
        <p className="muted small">Grant or revoke editors on a project's Access tab.</p>
        <table className="table">
          <thead><tr><th>Project</th><th>Editors</th><th></th></tr></thead>
          <tbody>
            {state.projects.map((p) => (
              <tr key={repoKey(p)}>
                <td className="mono">{p.owner}/{p.repo}</td>
                <td>{p.editors.length ? p.editors.map((e) => <span key={e} className="chip">{e}</span>) : <span className="muted">admins only</span>}</td>
                <td><Link to={`/p/${p.owner}/${p.repo}?tab=access`}>Manage →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {users.size > 0 && (
        <section className="card">
          <h3>Editors</h3>
          <table className="table">
            <thead><tr><th>User</th><th>Can edit</th></tr></thead>
            <tbody>
              {[...users].sort().map(([u, repos]) => (
                <tr key={u}><td>{u}</td><td>{repos.map((r) => <span key={r} className="chip">{r}</span>)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
