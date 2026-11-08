import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { parseRepo, repoKey } from '../lib/github';
import { scanRepository, toSummary } from '../lib/scan';
import { findProject, type Project } from '../lib/state';
import { EmptyState, ErrorBox } from '../components/ui';

export function Projects() {
  const { state, isAdmin, canEdit } = useSession();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const projects = state.projects
    .filter((p) => !q || repoKey(p).includes(q) || p.lastScan?.contracts.some((c) => c.title.toLowerCase().includes(q)))
    .sort((a, b) => repoKey(a).localeCompare(repoKey(b)));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">GitHub repositories tracked for OpenAPI and AsyncAPI contracts.</p>
        </div>
        <input className="search" placeholder="Filter projects or contracts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {isAdmin && <AddProject />}

      {projects.length === 0 ? (
        <EmptyState title={state.projects.length ? 'No projects match your filter' : 'No projects yet'}>
          {!state.projects.length && (isAdmin ? 'Add a repository above to start tracking its contracts.' : 'Ask an admin to add repositories.')}
        </EmptyState>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <ProjectCard key={repoKey(p)} project={p} editable={canEdit(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p, editable }: { project: Project; editable: boolean }) {
  const contracts = p.lastScan?.contracts ?? [];
  const openapi = contracts.filter((c) => c.kind === 'openapi').length;
  const asyncapi = contracts.filter((c) => c.kind === 'asyncapi').length;
  return (
    <Link to={`/p/${p.owner}/${p.repo}`} className="card project-card">
      <div className="project-card-head">
        <span className="project-owner">{p.owner} /</span>
        <span className="project-name">{p.repo}</span>
        {editable && <span className="pill pill-edit">can edit</span>}
      </div>
      <div className="project-stats">
        <span><strong>{openapi}</strong> OpenAPI</span>
        <span><strong>{asyncapi}</strong> AsyncAPI</span>
      </div>
      <div className="project-titles">
        {contracts.slice(0, 3).map((c) => (
          <span key={c.path} className={`chip chip-${c.kind}`}>{c.title}</span>
        ))}
        {contracts.length > 3 && <span className="chip">+{contracts.length - 3}</span>}
      </div>
      <div className="small muted">
        {p.lastScan ? `Scanned ${new Date(p.lastScan.at).toLocaleDateString()} on ${p.lastScan.branch}` : 'Not scanned yet'}
      </div>
    </Link>
  );
}

function AddProject() {
  const { gh, state, updateState, user } = useSession();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ref = parseRepo(value);
    if (!ref) return setError(new Error('Enter a repository as owner/name or a github.com URL.'));
    if (findProject(state, ref)) return setError(new Error(`${ref.owner}/${ref.repo} is already tracked.`));
    try {
      setBusy('Checking repository…');
      const info = await gh.getRepo(ref);
      setBusy('Scanning for contracts…');
      const scan = await scanRepository(gh, ref, info.defaultBranch);
      setBusy('Saving…');
      await updateState(`Track ${ref.owner}/${ref.repo}`, (s) => {
        if (findProject(s, ref)) return s;
        s.projects.push({
          ...ref,
          addedBy: user.login,
          addedAt: new Date().toISOString(),
          editors: [],
          lastScan: { at: new Date().toISOString(), branch: scan.branch, treeSha: scan.treeSha, contracts: scan.contracts.map(toSummary) },
        });
        return s;
      });
      setValue('');
    } catch (err) {
      setError((err as { status?: number }).status === 404 ? new Error('Repository not found or your GitHub account cannot read it.') : err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="card add-project" onSubmit={add}>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a repository: owner/name or https://github.com/owner/name" disabled={!!busy} />
      <button className="btn btn-primary" disabled={!!busy || !value.trim()}>
        {busy ?? 'Add repository'}
      </button>
      {error != null && <ErrorBox error={error} />}
    </form>
  );
}
