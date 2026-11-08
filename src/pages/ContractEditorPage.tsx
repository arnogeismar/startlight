import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { produce } from 'immer';
import { useSession } from '../lib/session';
import { isConflict, type RepoRef } from '../lib/github';
import {
  formatFromPath,
  isAsyncApi3,
  newContractTemplate,
  parseContract,
  serializeContract,
  validateContract,
  type ContractKind,
  type Doc,
  type FileFormat,
} from '../lib/contracts';
import { changeSummaryMarkdown, summarizeChanges } from '../lib/docEdit';
import { scanCache, scanCacheKey } from '../lib/scan';
import { EmptyState, ErrorBox, KindBadge, Spinner, useAsync } from '../components/ui';
import { InfoEditor } from '../components/editor/InfoEditor';
import { EndpointsSection } from '../components/editor/EndpointsSection';
import { SchemasSection } from '../components/editor/SchemasSection';
import { ChannelsSection, MessagesSection, OperationsSection } from '../components/editor/AsyncSections';
import { RawEditor } from '../components/editor/RawEditor';
import { PullRequestDialog, SaveDialog } from '../components/editor/SaveDialogs';

interface Loaded {
  defaultBranch: string;
  doc: Doc;
  /** Text of the file as it is on the branch ('' for a new file). */
  originalText: string;
  originalDoc: Doc | null;
  sha?: string;
  kind: ContractKind;
  format: FileFormat;
  indent: number;
  pr: { number: number; url: string } | null;
}

export function ContractEditorPage() {
  const { owner = '', repo = '' } = useParams();
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const branch = params.get('branch') ?? '';
  const newKind = params.get('new') as ContractKind | null;
  const newTitle = params.get('title') ?? 'New API';
  const ref: RepoRef = useMemo(() => ({ owner, repo }), [owner, repo]);
  const { gh, canEdit } = useSession();

  const loaded = useAsync(async (): Promise<Loaded> => {
    const [info, file, pr] = await Promise.all([gh.getRepo(ref), gh.readFile(ref, path, branch), gh.findOpenPullRequest(ref, branch)]);
    if (file) {
      const parsed = parseContract(file.text, path);
      return { defaultBranch: info.defaultBranch, doc: parsed.doc, originalText: file.text, originalDoc: parsed.doc, sha: file.sha, kind: parsed.kind, format: parsed.format, indent: parsed.indent, pr };
    }
    if (!newKind) throw new Error(`${path} does not exist on branch ${branch}.`);
    return { defaultBranch: info.defaultBranch, doc: newContractTemplate(newKind, newTitle), originalText: '', originalDoc: null, kind: newKind, format: formatFromPath(path), indent: 2, pr };
  }, [gh, owner, repo, path, branch, newKind]);

  if (!path || !branch) return <ErrorBox error="Missing file path or branch." />;
  if (!canEdit(ref)) {
    return (
      <EmptyState title="You don't have edit rights on this repository">
        Ask an admin to add you as an editor. <Link to={`/p/${owner}/${repo}`}>Back to overview</Link>
      </EmptyState>
    );
  }
  if (loaded.loading) return <Spinner label={`Loading ${path} from ${branch}…`} />;
  if (loaded.error || !loaded.data) return <ErrorBox error={loaded.error} onRetry={loaded.reload} />;
  if (branch === loaded.data.defaultBranch) {
    return (
      <EmptyState title={`Editing directly on ${branch} is not allowed`}>
        Start from the <Link to={`/p/${owner}/${repo}`}>project overview</Link> and choose a feature branch.
      </EmptyState>
    );
  }
  return <Editor key={`${path}@${branch}`} repo={ref} path={path} branch={branch} initial={loaded.data} />;
}

type Section = 'info' | 'endpoints' | 'channels' | 'operations' | 'messages' | 'schemas' | 'raw';

function sectionsFor(doc: Doc, kind: ContractKind): { id: Section; label: string }[] {
  if (kind === 'openapi') {
    return [
      { id: 'info', label: 'General' },
      { id: 'endpoints', label: 'Endpoints' },
      { id: 'schemas', label: 'Data models' },
      { id: 'raw', label: 'Raw file' },
    ];
  }
  return [
    { id: 'info', label: 'General' },
    { id: 'channels', label: 'Channels' },
    ...(isAsyncApi3(doc) ? [{ id: 'operations' as const, label: 'Operations' }] : []),
    { id: 'messages', label: 'Messages' },
    { id: 'schemas', label: 'Data models' },
    { id: 'raw', label: 'Raw file' },
  ];
}

const draftKey = (r: RepoRef, branch: string, path: string) => `contract-hub.draft:${r.owner}/${r.repo}@${branch}:${path}`;

function Editor({ repo, path, branch, initial }: { repo: RepoRef; path: string; branch: string; initial: Loaded }) {
  const { gh } = useSession();
  const [base, setBase] = useState({ text: initial.originalText, doc: initial.originalDoc, sha: initial.sha });
  const [doc, setDoc] = useState<Doc>(initial.doc);
  const docRef = useRef(doc);
  const history = useRef<{ past: Doc[]; future: Doc[]; lastAt: number }>({ past: [], future: [], lastAt: 0 });
  const [, forceRender] = useState(0);
  const [section, setSection] = useState<Section>(initial.kind === 'openapi' ? 'endpoints' : 'channels');
  const [saving, setSaving] = useState(false);
  const [prDialog, setPrDialog] = useState<null | { title: string; body: string }>(null);
  const [pr, setPr] = useState(initial.pr);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string; link?: string } | null>(null);
  const [draft, setDraft] = useState<Doc | null>(null);

  const text = useMemo(() => serializeContract(doc, initial.format, initial.indent, base.text), [doc, initial.format, initial.indent, base.text]);
  const dirty = text !== base.text;
  const issues = useMemo(() => validateContract(doc), [doc]);
  const key = draftKey(repo, branch, path);

  /** Applies an edit synchronously. Rapid edits (typing) are merged into one undo step. */
  const update = useCallback((fn: (d: Doc) => void) => {
    const next = produce(docRef.current, fn);
    if (next === docRef.current) return;
    const h = history.current;
    const now = Date.now();
    if (now - h.lastAt > 800 || !h.past.length) h.past = [...h.past.slice(-99), docRef.current];
    h.future = [];
    h.lastAt = now;
    docRef.current = next;
    setDoc(next);
  }, []);

  const replaceDoc = useCallback((next: Doc, record = true) => {
    if (record) {
      history.current.past.push(docRef.current);
      history.current.future = [];
    }
    history.current.lastAt = 0;
    docRef.current = next;
    setDoc(next);
  }, []);

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    h.lastAt = 0;
    docRef.current = prev;
    setDoc(prev);
    forceRender((x) => x + 1);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.lastAt = 0;
    docRef.current = next;
    setDoc(next);
    forceRender((x) => x + 1);
  };

  // Offer to restore unsaved work from a previous visit (only if made against the same file version).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as { baseSha?: string; doc: Doc };
      if (saved.baseSha === initial.sha && serializeContract(saved.doc, initial.format, initial.indent, initial.originalText) !== initial.originalText) setDraft(saved.doc);
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [key, initial]);

  // Autosave the working copy locally so a closed tab doesn't lose work.
  useEffect(() => {
    if (draft) return; // don't overwrite the stored draft before the user decides
    const t = setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(key, JSON.stringify({ baseSha: base.sha, doc }));
        else localStorage.removeItem(key);
      } catch {
        /* storage unavailable or full */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [doc, dirty, key, base.sha, draft]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function commit(message: string) {
    try {
      const res = await gh.writeFile(repo, path, text, message, { sha: base.sha, branch });
      setBase({ text, doc, sha: res.sha });
      scanCache.delete(scanCacheKey(repo, branch));
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      setSaving(false);
      setNotice({ kind: 'info', text: pr ? `Saved to ${branch}. Pull request #${pr.number} is updated automatically.` : `Saved to ${branch}. Request a review when you're ready.` });
    } catch (e) {
      if (isConflict(e)) {
        throw new Error(`Someone else changed ${path} on ${branch} since you opened it. Copy your changes from the Raw tab, reload the page and re-apply them.`);
      }
      throw e;
    }
  }

  async function openPrDialog() {
    const title = String(doc.info?.title ?? path);
    let body = `Contract changes to \`${path}\` made with Contract Hub.\n`;
    try {
      const onDefault = await gh.readFile(repo, path, initial.defaultBranch);
      const before = onDefault ? parseContract(onDefault.text, path).doc : null;
      const md = changeSummaryMarkdown(summarizeChanges(before, base.doc ?? doc));
      if (md) body += `\n### Changes compared to \`${initial.defaultBranch}\`\n${md}\n`;
    } catch {
      /* summary is best-effort */
    }
    setPrDialog({ title: base.doc && initial.originalDoc ? `Update ${title}` : `Add ${title}`, body });
  }

  const sections = sectionsFor(doc, initial.kind);
  const errors = issues.filter((i) => i.level === 'error').length;
  const props = { doc, update };

  return (
    <div className="editor-page">
      <div className="breadcrumbs">
        <Link to="/">Projects</Link> / <Link to={`/p/${repo.owner}/${repo.repo}?branch=${encodeURIComponent(branch)}`}>{repo.owner}/{repo.repo}</Link> / {path}
      </div>
      <div className="editor-header">
        <div>
          <div className="row gap-s">
            <KindBadge kind={initial.kind} />
            <h1>{doc.info?.title || path}</h1>
            {doc.info?.version && <span className="pill">v{doc.info.version}</span>}
          </div>
          <div className="small muted">
            <span className="mono">{path}</span> on branch <span className="branch-name">{branch}</span>
            {!base.sha && <span className="pill pill-warn">new file — not saved yet</span>}
          </div>
        </div>
        <div className="toolbar">
          <button className="btn btn-ghost" onClick={undo} disabled={!history.current.past.length} title="Undo">↶ Undo</button>
          <button className="btn btn-ghost" onClick={redo} disabled={!history.current.future.length} title="Redo">↷ Redo</button>
          {dirty && (
            <button className="btn btn-ghost" onClick={() => { if (confirm('Discard all unsaved changes?')) replaceDoc(base.doc ?? initial.doc); }}>
              Discard
            </button>
          )}
          <button className="btn btn-primary" disabled={!dirty} onClick={() => setSaving(true)}>
            {dirty ? 'Review & save' : 'Saved'}
          </button>
          {pr ? (
            <a className="btn" href={pr.url} target="_blank" rel="noreferrer">Pull request #{pr.number} ↗</a>
          ) : (
            <button className="btn" disabled={!base.sha || dirty} title={dirty ? 'Save your changes first' : !base.sha ? 'Save the file first' : ''} onClick={openPrDialog}>
              Request review
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div className="alert alert-info">
          <span>You have unsaved changes from a previous session.</span>
          <button className="btn btn-small btn-primary" onClick={() => { replaceDoc(draft); setDraft(null); }}>Restore them</button>
          <button className="btn btn-small" onClick={() => { try { localStorage.removeItem(key); } catch { /* ignore */ } setDraft(null); }}>Discard</button>
        </div>
      )}
      {notice && (
        <div className={`alert alert-${notice.kind}`}>
          <span>{notice.text}</span>
          <button className="btn-icon" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="editor-body">
        <nav className="editor-nav">
          {sections.map((s) => (
            <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
          <div className={`validation ${errors ? 'has-errors' : issues.length ? 'has-warnings' : 'ok'}`} title={issues.map((i) => i.message).join('\n')}>
            {errors ? `${errors} problem(s)` : issues.length ? `${issues.length} warning(s)` : '✓ Looks valid'}
          </div>
          {issues.length > 0 && (
            <ul className="issues small">
              {issues.slice(0, 8).map((i, k) => <li key={k} className={`issue-${i.level}`}>{i.message}</li>)}
              {issues.length > 8 && <li>…and {issues.length - 8} more</li>}
            </ul>
          )}
        </nav>
        <div className="editor-main">
          {section === 'info' && <InfoEditor {...props} />}
          {section === 'endpoints' && <EndpointsSection {...props} />}
          {section === 'schemas' && <SchemasSection {...props} />}
          {section === 'channels' && <ChannelsSection {...props} />}
          {section === 'operations' && <OperationsSection {...props} />}
          {section === 'messages' && <MessagesSection {...props} />}
          {section === 'raw' && <RawEditor doc={doc} format={initial.format} indent={initial.indent} baseText={base.text} onApply={(d) => replaceDoc(d)} />}
        </div>
      </div>

      {saving && (
        <SaveDialog
          title={String(doc.info?.title ?? path)}
          path={path}
          branch={branch}
          beforeText={base.text}
          afterText={text}
          beforeDoc={base.doc}
          afterDoc={doc}
          onClose={() => setSaving(false)}
          onSave={commit}
        />
      )}
      {prDialog && (
        <PullRequestDialog
          defaultTitle={prDialog.title}
          defaultBody={prDialog.body}
          base={initial.defaultBranch}
          branch={branch}
          onClose={() => setPrDialog(null)}
          onCreate={async (title, body) => {
            const created = await gh.createPullRequest(repo, branch, initial.defaultBranch, title, body);
            setPr(created);
            setPrDialog(null);
            setNotice({ kind: 'info', text: `Pull request #${created.number} created.` });
          }}
        />
      )}
    </div>
  );
}
