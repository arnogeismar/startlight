import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/session';
import { type RepoRef } from '../lib/github';
import { scanCache, scanCacheKey, scanRepository, toSummary, type ScannedContract } from '../lib/scan';
import { findProject } from '../lib/state';
import { listAsyncOperations, listEndpoints, slugify, type ContractKind } from '../lib/contracts';
import { ActionBadge, EmptyState, ErrorBox, Field, KindBadge, MethodBadge, Modal, Spinner, useAsync } from '../components/ui';
import { BranchDialog } from '../components/BranchDialog';
import { ProjectAccess } from '../components/ProjectAccess';

type Tab = 'contracts' | 'prs' | 'access';

export function ProjectOverview() {
  const { owner = '', repo = '' } = useParams();
  const ref: RepoRef = useMemo(() => ({ owner, repo }), [owner, repo]);
  const { gh, state, canEdit, isAdmin, updateState } = useSession();
  const project = findProject(state, ref);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'contracts');
  const [branchDialog, setBranchDialog] = useState<null | { then: (b: string) => void; suggestion?: string }>(null);
  const [newContract, setNewContract] = useState(false);
  const [rescanTick, setRescanTick] = useState(0);
  const editable = canEdit(ref);

  const repoInfo = useAsync(async () => {
    const [info, branches] = await Promise.all([gh.getRepo(ref), gh.listBranches(ref)]);
    return { ...info, branches };
  }, [gh, owner, repo]);

  const branch = params.get('branch') || repoInfo.data?.defaultBranch || '';
  const onDefault = branch === repoInfo.data?.defaultBranch;

  const scan = useAsync(async () => {
    if (!branch) return undefined;
    const key = scanCacheKey(ref, branch);
    if (scanCache.has(key)) return scanCache.get(key)!;
    const result = await scanRepository(gh, ref, branch);
    scanCache.set(key, result);
    return result;
  }, [gh, owner, repo, branch, rescanTick]);

  // Admins keep the stored summary (shown on the projects page) in sync with the default branch.
  const persisted = useRef('');
  useEffect(() => {
    const s = scan.data;
    if (!s || !project || !isAdmin || !onDefault) return;
    const summary = s.contracts.map(toSummary);
    const fingerprint = JSON.stringify(summary);
    if (fingerprint === JSON.stringify(project.lastScan?.contracts ?? null) || persisted.current === fingerprint) return;
    persisted.current = fingerprint;
    void updateState(`Update scan of ${owner}/${repo}`, (st) => {
      const p = findProject(st, ref);
      if (p) p.lastScan = { at: new Date().toISOString(), branch: s.branch, treeSha: s.treeSha, contracts: summary };
      return st;
    }).catch(() => undefined);
  }, [scan.data, project, isAdmin, onDefault, owner, repo, ref, updateState]);

  const selectBranch = (b: string) => setParams(b === repoInfo.data?.defaultBranch ? {} : { branch: b });

  /** Ensures we're on a feature branch before running an edit action. */
  function withFeatureBranch(then: (b: string) => void, suggestion?: string) {
    if (!onDefault) return then(branch);
    setBranchDialog({ then, suggestion });
  }

  const openEditor = (path: string, b: string, extra = '') =>
    navigate(`/p/${owner}/${repo}/edit?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(b)}${extra}`);

  if (!project) {
    return (
      <EmptyState title={`${owner}/${repo} is not a tracked project`}>
        <Link to="/">Back to projects</Link>
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="breadcrumbs"><Link to="/">Projects</Link> / {owner}/{repo}</div>
      <div className="page-header">
        <div>
          <h1>
            <span className="muted">{owner} /</span> {repo}
          </h1>
          {repoInfo.data?.description && <p className="muted">{repoInfo.data.description}</p>}
          <div className="row gap-s small">
            {repoInfo.data && <a href={repoInfo.data.htmlUrl} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}
            <span className={`pill ${editable ? 'pill-edit' : ''}`}>{editable ? 'You can edit' : 'Read only'}</span>
          </div>
        </div>
        {repoInfo.data && (
          <div className="toolbar">
            <label className="branch-select">
              <span>Branch</span>
              <select value={branch} onChange={(e) => selectBranch(e.target.value)}>
                {repoInfo.data.branches.map((b) => (
                  <option key={b} value={b}>{b}{b === repoInfo.data!.defaultBranch ? ' (default)' : ''}</option>
                ))}
              </select>
            </label>
            {editable && (
              <>
                <button className="btn" onClick={() => setBranchDialog({ then: selectBranch })}>New feature branch</button>
                <button className="btn btn-primary" onClick={() => setNewContract(true)}>+ New contract</button>
              </>
            )}
          </div>
        )}
      </div>

      {repoInfo.error != null && <ErrorBox error={repoInfo.error} onRetry={repoInfo.reload} />}

      <div className="tabs">
        <button className={tab === 'contracts' ? 'active' : ''} onClick={() => setTab('contracts')}>
          Contracts {scan.data && <span className="count">{scan.data.contracts.length}</span>}
        </button>
        <button className={tab === 'prs' ? 'active' : ''} onClick={() => setTab('prs')}>Pull requests</button>
        {isAdmin && <button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Access</button>}
      </div>

      {tab === 'contracts' && (
        <>
          <div className="row space-between small muted">
            <span>
              {scan.data
                ? `Found ${scan.data.contracts.length} contract(s) on ${branch}.`
                : scan.loading ? 'Scanning repository…' : ''}
              {scan.data?.truncated && ' The repository is very large; some files may not have been scanned.'}
              {!!scan.data?.skipped && ` ${scan.data.skipped} JSON/YAML files were skipped because their names don't look like API specs.`}
            </span>
            <button className="btn btn-small btn-ghost" onClick={() => { scanCache.delete(scanCacheKey(ref, branch)); setRescanTick((t) => t + 1); }} disabled={scan.loading}>↻ Rescan</button>
          </div>
          {scan.loading && <Spinner label="Scanning for OpenAPI and AsyncAPI files…" />}
          {scan.error != null && <ErrorBox error={scan.error} onRetry={scan.reload} />}
          {scan.data && !scan.loading && (
            scan.data.contracts.length === 0 ? (
              <EmptyState title="No contracts found on this branch">
                {editable && 'Use "+ New contract" to create one.'}
              </EmptyState>
            ) : (
              <ContractsOverview
                contracts={scan.data.contracts}
                editable={editable}
                fileUrl={(path) => `${repoInfo.data?.htmlUrl}/blob/${branch}/${path}`}
                onEdit={(c) => withFeatureBranch((b) => openEditor(c.path, b), c.title)}
              />
            )
          )}
        </>
      )}

      {tab === 'prs' && <PullRequests repo={ref} />}
      {tab === 'access' && isAdmin && <ProjectAccess project={project} />}

      {branchDialog && repoInfo.data && (
        <BranchDialog
          repo={ref}
          defaultBranch={repoInfo.data.defaultBranch}
          branches={repoInfo.data.branches}
          suggestion={branchDialog.suggestion}
          onClose={() => setBranchDialog(null)}
          onSelected={(b) => {
            const then = branchDialog.then;
            setBranchDialog(null);
            if (!repoInfo.data!.branches.includes(b)) repoInfo.setData({ ...repoInfo.data!, branches: [...repoInfo.data!.branches, b] });
            then(b);
          }}
        />
      )}

      {newContract && (
        <NewContractDialog
          existing={scan.data?.contracts.map((c) => c.path) ?? []}
          onClose={() => setNewContract(false)}
          onCreate={(kind, title, path) => {
            setNewContract(false);
            withFeatureBranch(
              (b) => openEditor(path, b, `&new=${kind}&title=${encodeURIComponent(title)}`),
              `add-${slugify(title)}`,
            );
          }}
        />
      )}
    </div>
  );
}

function ContractsOverview(props: {
  contracts: ScannedContract[];
  editable: boolean;
  fileUrl: (path: string) => string;
  onEdit: (c: ScannedContract) => void;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const openapi = props.contracts.filter((c) => c.kind === 'openapi');
  const asyncapi = props.contracts.filter((c) => c.kind === 'asyncapi');

  const card = (c: ScannedContract) => (
    <section key={c.path} className="card contract-card">
      <header className="contract-head">
        <div>
          <div className="row gap-s">
            <KindBadge kind={c.kind} />
            <h3>{c.title}</h3>
            {c.version && <span className="pill">v{c.version}</span>}
          </div>
          <a className="small mono" href={props.fileUrl(c.path)} target="_blank" rel="noreferrer">{c.path}</a>
          <span className="small muted"> · {c.kind === 'openapi' ? (c.doc.swagger ? 'Swagger' : 'OpenAPI') : 'AsyncAPI'} {c.specVersion}</span>
        </div>
        {props.editable && <button className="btn btn-primary" onClick={() => props.onEdit(c)}>Edit contract</button>}
      </header>
      {c.doc.info?.description && <p className="description">{String(c.doc.info.description).split('\n')[0]}</p>}
      {c.kind === 'openapi' ? <EndpointTable contract={c} q={q} /> : <AsyncTable contract={c} q={q} />}
    </section>
  );

  return (
    <div className="stack">
      <input className="search" placeholder="Search endpoints, channels, operations…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {openapi.length > 0 && <h2 className="section-title">REST endpoints (OpenAPI)</h2>}
      {openapi.map(card)}
      {asyncapi.length > 0 && <h2 className="section-title">Events &amp; messages (AsyncAPI)</h2>}
      {asyncapi.map(card)}
    </div>
  );
}

function EndpointTable({ contract, q }: { contract: ScannedContract; q: string }) {
  const endpoints = listEndpoints(contract.doc).filter(
    (e) => !q || `${e.method} ${e.path} ${e.summary} ${e.operationId} ${e.tags.join(' ')}`.toLowerCase().includes(q),
  );
  if (!endpoints.length) return <p className="muted small">{q ? 'No matching endpoints.' : 'No endpoints defined.'}</p>;
  const groups = new Map<string, typeof endpoints>();
  for (const e of endpoints) {
    const tag = e.tags[0] ?? 'Other';
    groups.set(tag, [...(groups.get(tag) ?? []), e]);
  }
  return (
    <table className="table">
      <tbody>
        {[...groups].map(([tag, eps]) => (
          <GroupRows key={tag} label={groups.size > 1 || tag !== 'Other' ? tag : null} cols={3}>
            {eps.map((e) => (
              <tr key={`${e.method} ${e.path}`} className={e.deprecated ? 'deprecated' : ''}>
                <td className="w-method"><MethodBadge method={e.method} /></td>
                <td className="mono">{e.path}</td>
                <td>{e.summary}{e.deprecated && <span className="pill pill-warn">deprecated</span>}</td>
              </tr>
            ))}
          </GroupRows>
        ))}
      </tbody>
    </table>
  );
}

function AsyncTable({ contract, q }: { contract: ScannedContract; q: string }) {
  const ops = listAsyncOperations(contract.doc).filter(
    (o) => !q || `${o.action} ${o.channel} ${o.summary} ${o.id} ${o.messages.join(' ')}`.toLowerCase().includes(q),
  );
  if (!ops.length) return <p className="muted small">{q ? 'No matching operations.' : 'No operations defined.'}</p>;
  return (
    <table className="table">
      <thead>
        <tr><th>Action</th><th>Channel</th><th>Message(s)</th><th>Summary</th></tr>
      </thead>
      <tbody>
        {ops.map((o) => (
          <tr key={`${o.id}-${o.action}-${o.channel}`}>
            <td className="w-method"><ActionBadge action={o.action} /></td>
            <td className="mono">{o.channel}</td>
            <td>{o.messages.map((m) => <span key={m} className="chip">{m}</span>)}</td>
            <td>{o.summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroupRows({ label, cols, children }: { label: string | null; cols: number; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <tr className="group-row"><td colSpan={cols}>{label}</td></tr>
      )}
      {children}
    </>
  );
}

function PullRequests({ repo }: { repo: RepoRef }) {
  const { gh } = useSession();
  const prs = useAsync(() => gh.listOpenPullRequests(repo), [gh, repo.owner, repo.repo]);
  if (prs.loading) return <Spinner />;
  if (prs.error) return <ErrorBox error={prs.error} onRetry={prs.reload} />;
  if (!prs.data?.length) return <EmptyState title="No open pull requests" />;
  return (
    <table className="table card">
      <thead><tr><th>#</th><th>Title</th><th>Branch</th><th>Author</th><th>Updated</th></tr></thead>
      <tbody>
        {prs.data.map((p) => (
          <tr key={p.number}>
            <td>#{p.number}</td>
            <td><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a></td>
            <td className="mono small">{p.branch}</td>
            <td>{p.author}</td>
            <td className="small muted">{new Date(p.updatedAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NewContractDialog(props: { existing: string[]; onClose: () => void; onCreate: (kind: ContractKind, title: string, path: string) => void }) {
  const [kind, setKind] = useState<ContractKind>('openapi');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<'yaml' | 'json'>('yaml');
  const [path, setPath] = useState('');
  const [touched, setTouched] = useState(false);
  const suggested = `${kind === 'openapi' ? 'openapi' : 'asyncapi'}/${slugify(title) || 'new-api'}.${format === 'yaml' ? 'yaml' : 'json'}`;
  const finalPath = touched ? path : suggested;
  const err = !title.trim()
    ? 'Give the API a name.'
    : !/\.(json|ya?ml)$/i.test(finalPath)
      ? 'File must end in .yaml, .yml or .json.'
      : props.existing.includes(finalPath)
        ? 'A contract already exists at that path.'
        : null;
  return (
    <Modal
      title="New contract"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!!err} onClick={() => props.onCreate(kind, title.trim(), finalPath.replace(/^\/+/, ''))}>Continue</button>
        </>
      }
    >
      <div className="segmented">
        <button className={kind === 'openapi' ? 'active' : ''} onClick={() => setKind('openapi')}>REST API (OpenAPI)</button>
        <button className={kind === 'asyncapi' ? 'active' : ''} onClick={() => setKind('asyncapi')}>Events (AsyncAPI)</button>
      </div>
      <Field label="API name"><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Orders API" /></Field>
      <Field label="File format">
        <select value={format} onChange={(e) => setFormat(e.target.value as 'yaml' | 'json')}>
          <option value="yaml">YAML</option>
          <option value="json">JSON</option>
        </select>
      </Field>
      <Field label="File path in repository">
        <input className="mono" value={finalPath} onChange={(e) => { setTouched(true); setPath(e.target.value); }} />
      </Field>
      {title && err && <p className="field-error">{err}</p>}
    </Modal>
  );
}
