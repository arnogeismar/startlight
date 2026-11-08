import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { validateContract, type Doc } from '../../lib/contracts';
import { changeSummaryMarkdown, summarizeChanges, type ChangeSummary } from '../../lib/docEdit';
import { ErrorBox, Field, Modal } from '../ui';

export function ChangeList({ summary }: { summary: ChangeSummary }) {
  if (!summary.added.length && !summary.changed.length && !summary.removed.length) {
    return <p className="muted small">Formatting-only changes.</p>;
  }
  return (
    <ul className="change-list">
      {summary.added.map((a) => <li key={'a' + a} className="added">Added {a}</li>)}
      {summary.changed.map((c) => <li key={'c' + c} className="changed">Changed {c}</li>)}
      {summary.removed.map((r) => <li key={'r' + r} className="removed">Removed {r}</li>)}
    </ul>
  );
}

/** Unified line diff with long unchanged stretches collapsed. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  const CONTEXT = 3;
  const rows: { type: 'add' | 'del' | 'ctx' | 'gap'; text: string }[] = [];
  parts.forEach((p, idx) => {
    const lines = p.value.replace(/\n$/, '').split('\n');
    if (p.added) lines.forEach((l) => rows.push({ type: 'add', text: l }));
    else if (p.removed) lines.forEach((l) => rows.push({ type: 'del', text: l }));
    else {
      const first = idx === 0;
      const last = idx === parts.length - 1;
      const head = first ? [] : lines.slice(0, CONTEXT);
      const tail = last ? [] : lines.slice(-CONTEXT);
      if (lines.length <= head.length + tail.length + 1) lines.forEach((l) => rows.push({ type: 'ctx', text: l }));
      else {
        head.forEach((l) => rows.push({ type: 'ctx', text: l }));
        rows.push({ type: 'gap', text: `… ${lines.length - head.length - tail.length} unchanged lines …` });
        tail.forEach((l) => rows.push({ type: 'ctx', text: l }));
      }
    }
  });
  return (
    <pre className="diff">
      {rows.map((r, i) => (
        <div key={i} className={`diff-${r.type}`}>
          <span className="diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
          {r.text}
        </div>
      ))}
    </pre>
  );
}

export function SaveDialog(props: {
  title: string;
  path: string;
  branch: string;
  beforeText: string;
  afterText: string;
  beforeDoc: Doc | null;
  afterDoc: Doc;
  onClose: () => void;
  onSave: (message: string) => Promise<void>;
}) {
  const summary = useMemo(() => summarizeChanges(props.beforeDoc, props.afterDoc), [props.beforeDoc, props.afterDoc]);
  const issues = useMemo(() => validateContract(props.afterDoc), [props.afterDoc]);
  const errors = issues.filter((i) => i.level === 'error');
  const defaultMsg = props.beforeDoc
    ? `Update ${props.title}${summary.added.length + summary.changed.length + summary.removed.length === 1 ? `: ${[...summary.added.map((x) => `add ${x}`), ...summary.changed.map((x) => `change ${x}`), ...summary.removed.map((x) => `remove ${x}`)][0]}` : ''}`
    : `Add ${props.title} contract`;
  const [message, setMessage] = useState(defaultMsg);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [ack, setAck] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await props.onSave(`${message.trim()}\n\n${changeSummaryMarkdown(summary)}`.trim());
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title="Review & save changes"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose} disabled={busy}>Keep editing</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !message.trim() || (errors.length > 0 && !ack)}>
            {busy ? 'Saving…' : `Save to ${props.branch}`}
          </button>
        </>
      }
    >
      <p className="small muted">
        Commits <code>{props.path}</code> to branch <code>{props.branch}</code>.
      </p>
      <h4>What changed</h4>
      <ChangeList summary={summary} />
      {issues.length > 0 && (
        <>
          <h4>Checks</h4>
          <ul className="issues">
            {issues.map((i, k) => <li key={k} className={`issue-${i.level}`}>{i.message}</li>)}
          </ul>
          {errors.length > 0 && (
            <label className="checkbox small">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Save anyway — I'll fix these later
            </label>
          )}
        </>
      )}
      <Field label="Describe your change" hint="Becomes the commit message.">
        <input value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <button className="btn btn-small btn-ghost" onClick={() => setShowDiff((s) => !s)}>{showDiff ? 'Hide' : 'Show'} file changes</button>
      {showDiff && <DiffView before={props.beforeText} after={props.afterText} />}
      {error != null && <ErrorBox error={error} />}
    </Modal>
  );
}

export function PullRequestDialog(props: {
  defaultTitle: string;
  defaultBody: string;
  base: string;
  branch: string;
  onClose: () => void;
  onCreate: (title: string, body: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.defaultTitle);
  const [body, setBody] = useState(props.defaultBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      wide
      title="Request review (pull request)"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onCreate(title.trim(), body);
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            {busy ? 'Creating…' : 'Create pull request'}
          </button>
        </>
      }
    >
      <p className="small muted">
        Asks the repository's reviewers to merge <code>{props.branch}</code> into <code>{props.base}</code>.
      </p>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description" hint="Markdown supported."><textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      {error != null && <ErrorBox error={error} />}
    </Modal>
  );
}
