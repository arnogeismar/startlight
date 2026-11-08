import { useState } from 'react';
import { getIn, schemaContainer, type Doc } from '../../lib/contracts';
import { countRefs, escapePointer, renameKey, renameRefs, schemaLabel, uniqueKey } from '../../lib/docEdit';
import { CommitInput, Field } from '../ui';
import { ListDetail } from './ListDetail';
import { SchemaEditor, type EditorProps } from './SchemaEditor';

/** Reusable data models (components/schemas or definitions). Renames keep all $refs in sync. */
export function SchemasSection({ doc, update }: EditorProps) {
  const { path, refPrefix } = schemaContainer(doc);
  const schemas: Doc = getIn(doc, path) ?? {};
  const names = Object.keys(schemas);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const current = selected && selected in schemas ? selected : null;

  const add = () => {
    const name = uniqueKey(schemas, 'NewModel');
    update((d) => {
      const container = path.reduce<Doc>((o, k) => (o[k] ??= {}), d);
      container[name] = { type: 'object', properties: {} };
    });
    setSelected(name);
  };

  const usages = current ? countRefs(doc, refPrefix + escapePointer(current)) : 0;

  return (
    <ListDetail
      items={names.map((n) => ({ key: n, label: <><span className="mono">{n}</span><span className="small muted"> {schemaLabel(schemas[n])}</span></>, search: n }))}
      selected={current}
      onSelect={setSelected}
      onAdd={add}
      addLabel="+ New data model"
      empty="Data models describe the shape of request/response bodies and messages. Select one or create a new one."
    >
      {current && (
        <div className="stack">
          <div className="row gap-s space-between">
            <Field label="Model name" hint={usages ? `Used in ${usages} place(s); renaming updates them all.` : 'Not used anywhere yet.'}>
              <CommitInput
                className="mono"
                value={current}
                validate={(v) => (!/^[A-Za-z0-9._-]+$/.test(v) ? 'Use letters, numbers, ".", "_" or "-"' : v !== current && v in schemas ? 'Already exists' : null)}
                onCommit={(v) => {
                  update((d) => {
                    renameKey(getIn(d, path)!, current, v);
                    renameRefs(d, refPrefix + escapePointer(current), refPrefix + escapePointer(v));
                  });
                  setSelected(v);
                }}
              />
            </Field>
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                if (usages && !confirm(`${current} is used in ${usages} place(s). Delete it anyway? Those references will break.`)) return;
                update((d) => { delete getIn(d, path)![current]; });
                setSelected(null);
              }}
            >
              Delete model
            </button>
          </div>
          <SchemaEditor doc={doc} update={update} path={[...path, current]} />
        </div>
      )}
    </ListDetail>
  );
}
