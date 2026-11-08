import { useMemo, useState } from 'react';
import YAML from 'yaml';
import { detectKind, serializeContract, type Doc, type FileFormat } from '../../lib/contracts';

/** Full-document text editor for power users. Changes apply only when the text parses. */
export function RawEditor(props: { doc: Doc; format: FileFormat; indent: number; baseText?: string; onApply: (d: Doc) => void }) {
  const initial = useMemo(() => serializeContract(props.doc, props.format, props.indent, props.baseText), [props.doc, props.format, props.indent, props.baseText]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = text ?? initial;

  function apply() {
    try {
      const parsed = props.format === 'json' ? JSON.parse(current) : YAML.parse(current);
      if (!detectKind(parsed)) throw new Error('The document must keep its openapi / asyncapi version field.');
      props.onApply(parsed);
      setText(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        The full file as {props.format.toUpperCase()}. Edits here are applied to the forms when you click "Apply".
      </p>
      <textarea className="mono raw-editor" value={current} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row gap-s">
        <button className="btn btn-primary" disabled={text === null} onClick={apply}>Apply</button>
        <button className="btn" disabled={text === null} onClick={() => { setText(null); setError(null); }}>Discard text changes</button>
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}
