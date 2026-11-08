import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { findProject, isAdmin as isAdminOf, type Project } from '../lib/state';
import { repoKey } from '../lib/github';
import { ErrorBox } from './ui';

export function ProjectAccess({ project }: { project: Project }) {
  const { gh, state, updateState } = useSession();
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [grantGithub, setGrantGithub] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const name = `${project.owner}/${project.repo}`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const addEditor = (e: React.FormEvent) => {
    e.preventDefault();
    const who = login.trim().replace(/^@/, '');
    if (!who) return;
    void run(async () => {
      if (project.editors.some((x) => x.toLowerCase() === who.toLowerCase())) throw new Error(`${who} can already edit ${name}.`);
      if (!(await gh.userExists(who))) throw new Error(`GitHub user "${who}" does not exist.`);
      await updateState(`Grant ${who} edit rights on ${name}`, (s) => {
        const p = findProject(s, project);
        if (p && !p.editors.some((x) => x.toLowerCase() === who.toLowerCase())) p.editors.push(who);
        return s;
      });
      setLogin('');
      if (grantGithub) {
        try {
          await gh.addCollaborator(project, who, 'push');
          setNotice(`${who} can now edit in Contract Hub and was invited as a collaborator with write access on GitHub.`);
        } catch (err) {
          setNotice(
            `${who} can now edit in Contract Hub, but GitHub write access could not be granted (${(err as Error).message}). ` +
              `They need write access to ${name} (directly or via a team) to push branches.`,
          );
        }
      }
    });
  };

  const removeEditor = (who: string) =>
    run(() =>
      updateState(`Revoke ${who} edit rights on ${name}`, (s) => {
        const p = findProject(s, project);
        if (p) p.editors = p.editors.filter((x) => x.toLowerCase() !== who.toLowerCase());
        return s;
      }),
    );

  const removeProject = () => {
    if (!confirm(`Stop tracking ${name}? The repository itself is not changed.`)) return;
    void run(async () => {
      await updateState(`Stop tracking ${name}`, (s) => ({ ...s, projects: s.projects.filter((p) => repoKey(p) !== repoKey(project)) }));
      navigate('/');
    });
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>Editors</h3>
        <p className="muted small">
          Everyone signed in can read this project. Editors can create feature branches, change contracts and open pull requests.
          Admins ({state.admins.join(', ')}) can always edit.
        </p>
        {project.editors.length === 0 ? (
          <p className="muted">No editors yet.</p>
        ) : (
          <ul className="user-list">
            {project.editors.map((e) => (
              <li key={e}>
                <img src={`https://github.com/${e}.png?size=48`} alt="" />
                <a href={`https://github.com/${e}`} target="_blank" rel="noreferrer">{e}</a>
                {isAdminOf(state, e) && <span className="pill">admin</span>}
                <button className="btn btn-small btn-danger-ghost" disabled={busy} onClick={() => removeEditor(e)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <form className="row gap-s wrap" onSubmit={addEditor}>
          <input placeholder="GitHub username" value={login} onChange={(e) => setLogin(e.target.value)} disabled={busy} />
          <button className="btn btn-primary" disabled={busy || !login.trim()}>Give edit rights</button>
          <label className="checkbox small">
            <input type="checkbox" checked={grantGithub} onChange={(e) => setGrantGithub(e.target.checked)} />
            Also grant write access on GitHub (requires repo admin)
          </label>
        </form>
        {notice && <div className="alert alert-info">{notice}</div>}
        {error != null && <ErrorBox error={error} />}
      </section>
      <section className="card danger-zone">
        <h3>Remove project</h3>
        <p className="muted small">Stops tracking this repository in Contract Hub. Nothing in the repository is deleted.</p>
        <button className="btn btn-danger" disabled={busy} onClick={removeProject}>Stop tracking {name}</button>
      </section>
    </div>
  );
}
