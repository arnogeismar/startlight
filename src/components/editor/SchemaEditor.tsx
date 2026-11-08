import { useState } from 'react';
import { getIn, schemaContainer, refName, type Doc } from '../../lib/contracts';
import { convertSchema, escapePointer, renameKey, schemaKind, schemaLabel, setIn, type Path, type SchemaKind } from '../../lib/docEdit';
import { CommitInput } from '../ui';
import { JsonNodeEditor } from './JsonNodeEditor';

export interface EditorProps {
  doc: Doc;
  update: (fn: (d: Doc) => void) => void;
}

const KIND_OPTIONS: { value: SchemaKind; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Decimal number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'object', label: 'Object (fields)' },
  { value: 'array', label: 'List' },
  { value: 'ref', label: 'Reusable schema…' },
  { value: 'any', label: 'Anything' },
  { value: 'advanced', label: 'Advanced (JSON)' },
];

const FORMATS: Record<string, string[]> = {
  string: ['', 'date', 'date-time', 'time', 'email', 'uuid', 'uri', 'hostname', 'ipv4', 'password', 'byte', 'binary'],
  integer: ['', 'int32', 'int64'],
  number: ['', 'float', 'double'],
};

export function useSchemaNames(doc: Doc) {
  const { path, refPrefix } = schemaContainer(doc);
  const names = Object.keys(getIn(doc, path) ?? {});
  return { names, refPrefix };
}

export function TypePicker(props: { doc: Doc; schema: Doc | undefined; onChange: (s: Doc) => void; compact?: boolean }) {
  const { names, refPrefix } = useSchemaNames(props.doc);
  const kind = schemaKind(props.schema);
  return (
    <span className="type-picker">
      <select
        value={kind}
        className={props.compact ? 'compact' : ''}
        onChange={(e) => {
          const k = e.target.value as SchemaKind;
          props.onChange(convertSchema(props.schema, k, names[0] ? refPrefix + escapePointer(names[0]) : undefined));
        }}
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} disabled={o.value === 'ref' && !names.length}>
            {o.label}
          </option>
        ))}
      </select>
      {kind === 'ref' && (
        <select
          className={props.compact ? 'compact' : ''}
          value={props.schema?.$ref ?? ''}
          onChange={(e) => props.onChange({ $ref: e.target.value })}
        >
          {!names.some((n) => refPrefix + escapePointer(n) === props.schema?.$ref) && (
            <option value={props.schema?.$ref}>{refName(props.schema?.$ref ?? '?')}</option>
          )}
          {names.map((n) => (
            <option key={n} value={refPrefix + escapePointer(n)}>{n}</option>
          ))}
        </select>
      )}
    </span>
  );
}

/**
 * Form-based editor for a JSON Schema node located at `path` inside the document.
 * Covers the common cases visually and falls back to a JSON editor for anything exotic.
 */
export function SchemaEditor({ doc, update, path, depth = 0 }: EditorProps & { path: Path; depth?: number }) {
  const schema: Doc | undefined = getIn(doc, path);
  const kind = schemaKind(schema);
  const set = (key: string, value: unknown) =>
    update((d) => {
      const s = getIn(d, path);
      if (!s) return setIn(d, path, value === undefined || value === '' ? {} : { [key]: value });
      if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete s[key];
      else s[key] = value;
    });

  return (
    <div className={`schema-editor depth-${Math.min(depth, 4)}`}>
      <div className="schema-row">
        <TypePicker doc={doc} schema={schema} onChange={(s) => update((d) => setIn(d, path, s))} />
        {kind !== 'ref' && (
          <input
            className="grow"
            placeholder="Description (what is this?)"
            value={schema?.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        )}
      </div>

      {(kind === 'string' || kind === 'integer' || kind === 'number') && (
        <div className="schema-row wrap">
          <label className="inline">
            Format
            <select value={schema?.format ?? ''} onChange={(e) => set('format', e.target.value)}>
              {FORMATS[kind].map((f) => (
                <option key={f} value={f}>{f || '—'}</option>
              ))}
            </select>
          </label>
          <label className="inline grow">
            Allowed values
            <CommitInput
              placeholder="comma separated, leave empty for any"
              value={(schema?.enum ?? []).join(', ')}
              onCommit={(v) => {
                const vals = v.split(',').map((x) => x.trim()).filter(Boolean);
                set('enum', kind === 'string' ? vals : vals.map(Number).filter((n) => !Number.isNaN(n)));
              }}
            />
          </label>
          <label className="inline">
            Example
            <input
              value={schema?.example ?? ''}
              onChange={(e) => set('example', kind === 'string' || e.target.value === '' ? e.target.value : Number(e.target.value))}
            />
          </label>
          {kind === 'string' ? (
            <>
              <NumberField label="Min length" value={schema?.minLength} onChange={(v) => set('minLength', v)} />
              <NumberField label="Max length" value={schema?.maxLength} onChange={(v) => set('maxLength', v)} />
              <label className="inline">
                Pattern
                <input className="mono" value={schema?.pattern ?? ''} onChange={(e) => set('pattern', e.target.value)} placeholder="regex" />
              </label>
            </>
          ) : (
            <>
              <NumberField label="Minimum" value={schema?.minimum} onChange={(v) => set('minimum', v)} />
              <NumberField label="Maximum" value={schema?.maximum} onChange={(v) => set('maximum', v)} />
            </>
          )}
        </div>
      )}

      {kind === 'array' && (
        <div className="nested">
          <div className="nested-label">Each item in the list is:</div>
          <SchemaEditor doc={doc} update={update} path={[...path, 'items']} depth={depth + 1} />
        </div>
      )}

      {kind === 'object' && <PropertiesTable doc={doc} update={update} path={path} depth={depth} />}

      {kind === 'advanced' && (
        <div className="nested">
          <div className="nested-label">This schema uses features not covered by the form. Edit it as JSON:</div>
          <JsonNodeEditor value={schema} onApply={(v) => update((d) => setIn(d, path, v))} />
        </div>
      )}
    </div>
  );
}

function NumberField(props: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="inline">
      {props.label}
      <input
        type="number"
        className="num"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

function PropertiesTable({ doc, update, path, depth }: EditorProps & { path: Path; depth: number }) {
  const schema: Doc = getIn(doc, path) ?? {};
  const props: Doc = schema.properties ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const names = Object.keys(props);

  const mutate = (fn: (s: Doc) => void) =>
    update((d) => {
      const s = getIn(d, path);
      if (s) fn(s);
    });

  const addField = () =>
    mutate((s) => {
      s.properties ??= {};
      let name = 'newField';
      for (let i = 2; name in s.properties; i++) name = `newField${i}`;
      s.properties[name] = { type: 'string' };
    });

  return (
    <div className="nested">
      <table className="props-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th title="Must always be present">Required</th>
            <th>Description</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {names.length === 0 && (
            <tr>
              <td colSpan={6} className="muted small">No fields yet.</td>
            </tr>
          )}
          {names.map((name) => {
            const p: Doc = props[name] ?? {};
            const k = schemaKind(p);
            const expandable = k === 'object' || k === 'array' || k === 'advanced' || k === 'string' || k === 'integer' || k === 'number';
            return (
              <PropRow
                key={name}
                name={name}
                open={!!open[name]}
                expandable={expandable}
                onToggle={() => setOpen((o) => ({ ...o, [name]: !o[name] }))}
                cells={
                  <>
                    <td>
                      <CommitInput
                        className="mono"
                        value={name}
                        validate={(v) => (!v.trim() ? 'Required' : v !== name && v in props ? 'Already exists' : null)}
                        onCommit={(v) =>
                          mutate((s) => {
                            renameKey(s.properties, name, v.trim());
                            if (Array.isArray(s.required)) s.required = s.required.map((r: string) => (r === name ? v.trim() : r));
                          })
                        }
                      />
                    </td>
                    <td>
                      <TypePicker
                        compact
                        doc={doc}
                        schema={p}
                        onChange={(ns) => mutate((s) => (s.properties[name] = ns))}
                      />
                      <span className="small muted type-label">{k === 'array' ? schemaLabel(p) : ''}</span>
                    </td>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={required.includes(name)}
                        onChange={(e) =>
                          mutate((s) => {
                            const r = new Set<string>(s.required ?? []);
                            if (e.target.checked) r.add(name);
                            else r.delete(name);
                            const ordered = Object.keys(s.properties).filter((n) => r.has(n));
                            if (ordered.length) s.required = ordered;
                            else delete s.required;
                          })
                        }
                      />
                    </td>
                    <td>
                      {k === 'ref' ? (
                        <span className="muted small">described by {refName(p.$ref)}</span>
                      ) : (
                        <input
                          value={p.description ?? ''}
                          placeholder="—"
                          onChange={(e) =>
                            mutate((s) => {
                              if (e.target.value) s.properties[name].description = e.target.value;
                              else delete s.properties[name].description;
                            })
                          }
                        />
                      )}
                    </td>
                    <td className="right nowrap">
                      <button
                        className="btn-icon danger"
                        title={`Remove ${name}`}
                        onClick={() =>
                          mutate((s) => {
                            delete s.properties[name];
                            if (Array.isArray(s.required)) {
                              s.required = s.required.filter((r: string) => r !== name);
                              if (!s.required.length) delete s.required;
                            }
                          })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </>
                }
              >
                <SchemaEditor doc={doc} update={update} path={[...path, 'properties', name]} depth={depth + 1} />
              </PropRow>
            );
          })}
        </tbody>
      </table>
      <button className="btn btn-small" onClick={addField}>+ Add field</button>
    </div>
  );
}

function PropRow(props: {
  name: string;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
  cells: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr>
        {props.cells}
        <td className="nowrap">
          {props.expandable && (
            <button className="btn-icon" onClick={props.onToggle} title={props.open ? 'Hide details' : 'Show details'}>
              {props.open ? '▾' : '▸'}
            </button>
          )}
        </td>
      </tr>
      {props.open && (
        <tr className="detail-row">
          <td colSpan={6}>{props.children}</td>
        </tr>
      )}
    </>
  );
}
