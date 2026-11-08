import { useEffect, useState } from 'react';

/** Escape hatch: edit an arbitrary JSON value as text, applied only when it parses. */
export function JsonNodeEditor({ value, onApply, rows = 8 }: { value: unknown; onApply: (v: unknown) => void; rows?: number }) {
  const initial = JSON.stringify(value ?? {}, null, 2);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(initial), [initial]);
  const dirty = text !== initial;
  return (
    <div className="json-node">
      <textarea className="mono" rows={rows} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row gap-s">
        <button
          className="btn btn-small"
          disabled={!dirty}
          onClick={() => {
            try {
              onApply(JSON.parse(text));
              setError(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Apply JSON
        </button>
        {dirty && <button className="btn btn-small btn-ghost" onClick={() => { setText(initial); setError(null); }}>Reset</button>}
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}
