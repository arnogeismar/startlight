import { useState } from 'react';
import { HTTP_METHODS, isSwagger2, listEndpoints, refName, resolveRef, type Doc, type HttpMethod } from '../../lib/contracts';
import { renameKey, setIn, type Path } from '../../lib/docEdit';
import { CommitInput, Field, MethodBadge, Modal } from '../ui';
import { ListDetail } from './ListDetail';
import { SchemaEditor, TypePicker, type EditorProps } from './SchemaEditor';
import { JsonNodeEditor } from './JsonNodeEditor';

const opKey = (method: string, path: string) => `${method} ${path}`;
const parseKey = (k: string) => {
  const i = k.indexOf(' ');
  return { method: k.slice(0, i) as HttpMethod, path: k.slice(i + 1) };
};

const STATUS_CODES: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '204': 'No content',
  '400': 'Bad request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not found',
  '409': 'Conflict',
  '422': 'Unprocessable entity',
  '500': 'Internal server error',
  default: 'Unexpected error',
};

const CONTENT_TYPES = ['application/json', 'application/xml', 'text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded', 'application/octet-stream'];

export function EndpointsSection({ doc, update }: EditorProps) {
  const endpoints = listEndpoints(doc);
  const [selected, setSelected] = useState<string | null>(endpoints[0] ? opKey(endpoints[0].method, endpoints[0].path) : null);
  const [adding, setAdding] = useState(false);
  const current = selected && endpoints.some((e) => opKey(e.method, e.path) === selected) ? parseKey(selected) : null;

  return (
    <>
      <ListDetail
        items={endpoints.map((e) => ({
          key: opKey(e.method, e.path),
          group: e.tags[0] ?? (endpoints.some((x) => x.tags.length) ? 'Other' : undefined),
          search: `${e.method} ${e.path} ${e.summary} ${e.operationId}`,
          label: (
            <span className="endpoint-item">
              <MethodBadge method={e.method} />
              <span className="mono">{e.path}</span>
            </span>
          ),
        })).sort((a, b) => (a.group ?? '').localeCompare(b.group ?? ''))}
        selected={current ? selected : null}
        onSelect={setSelected}
        onAdd={() => setAdding(true)}
        addLabel="+ New endpoint"
        empty="Select an endpoint to edit it, or create a new one."
      >
        {current && (
          <OperationEditor
            key={selected}
            doc={doc}
            update={update}
            method={current.method}
            path={current.path}
            onMoved={(m, p) => setSelected(opKey(m, p))}
            onDeleted={() => setSelected(null)}
          />
        )}
      </ListDetail>
      {adding && (
        <AddEndpointDialog
          doc={doc}
          onClose={() => setAdding(false)}
          onAdd={(method, path, summary, tag) => {
            update((d) => {
              d.paths ??= {};
              d.paths[path] ??= {};
              const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) =>
                isSwagger2(d)
                  ? { name: m[1], in: 'path', required: true, type: 'string' }
                  : { name: m[1], in: 'path', required: true, schema: { type: 'string' } },
              );
              d.paths[path][method] = {
                summary,
                ...(tag ? { tags: [tag] } : {}),
                ...(params.length ? { parameters: params } : {}),
                responses: { [method === 'post' ? '201' : method === 'delete' ? '204' : '200']: { description: method === 'post' ? 'Created' : method === 'delete' ? 'No content' : 'OK' } },
              };
            });
            setSelected(opKey(method, path));
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function AddEndpointDialog(props: { doc: Doc; onClose: () => void; onAdd: (m: HttpMethod, p: string, summary: string, tag: string) => void }) {
  const [method, setMethod] = useState<HttpMethod>('get');
  const [path, setPath] = useState('/');
  const [summary, setSummary] = useState('');
  const tags: string[] = [...new Set([...(props.doc.tags ?? []).map((t: Doc) => t.name), ...listEndpoints(props.doc).flatMap((e) => e.tags)])].filter(Boolean);
  const [tag, setTag] = useState(tags[0] ?? '');
  const normalized = '/' + path.trim().replace(/^\/+/, '');
  const err = props.doc.paths?.[normalized]?.[method]
    ? `${method.toUpperCase()} ${normalized} already exists.`
    : /\s/.test(normalized)
      ? 'Paths cannot contain spaces.'
      : null;
  return (
    <Modal
      title="New endpoint"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!!err} onClick={() => props.onAdd(method, normalized, summary, tag)}>Create endpoint</button>
        </>
      }
    >
      <div className="row gap-s">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Path" hint="Use {name} for variable parts, e.g. /orders/{orderId}" className="grow">
          <input className="mono" value={path} onChange={(e) => setPath(e.target.value)} autoFocus />
        </Field>
      </div>
      <Field label="Summary" hint="Short description, e.g. 'Get an order by id'">
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Group (tag)">
        <input list="tag-options" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="optional" />
        <datalist id="tag-options">{tags.map((t) => <option key={t} value={t} />)}</datalist>
      </Field>
      {err && <p className="field-error">{err}</p>}
    </Modal>
  );
}

function OperationEditor(props: EditorProps & { method: HttpMethod; path: string; onMoved: (m: HttpMethod, p: string) => void; onDeleted: () => void }) {
  const { doc, update, method, path } = props;
  const base: Path = ['paths', path, method];
  const op: Doc = doc.paths[path][method];
  const swagger = isSwagger2(doc);
  const set = (key: string, value: unknown) =>
    update((d) => {
      const o = d.paths[path][method];
      if (value === '' || value === undefined || value === false || (Array.isArray(value) && !value.length)) delete o[key];
      else o[key] = value;
    });

  const move = (newMethod: HttpMethod, newPath: string) => {
    if (newMethod === method && newPath === path) return;
    update((d) => {
      const opObj = d.paths[path][method];
      delete d.paths[path][method];
      const remaining = Object.keys(d.paths[path]).filter((k) => HTTP_METHODS.includes(k as HttpMethod));
      if (newPath !== path && !remaining.length && !d.paths[newPath]) {
        // Only operation on this path: rename the path in place to keep ordering.
        renameKey(d.paths, path, newPath);
      } else if (!remaining.length && newPath !== path) {
        delete d.paths[path];
      }
      d.paths[newPath] ??= {};
      d.paths[newPath][newMethod] = opObj;
    });
    props.onMoved(newMethod, newPath);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="row gap-s wrap">
          <select
            className={`method-select method-${method}`}
            value={method}
            onChange={(e) => {
              const m = e.target.value as HttpMethod;
              if (doc.paths[path][m]) return alert(`${m.toUpperCase()} ${path} already exists.`);
              move(m, path);
            }}
          >
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
          <CommitInput
            className="mono grow path-input"
            value={path}
            validate={(v) => (!v.startsWith('/') ? 'Must start with /' : v !== path && doc.paths[v]?.[method] ? 'Already exists' : null)}
            onCommit={(v) => move(method, v)}
          />
          <button
            className="btn btn-danger-ghost"
            onClick={() => {
              if (!confirm(`Delete ${method.toUpperCase()} ${path}?`)) return;
              update((d) => {
                delete d.paths[path][method];
                if (!Object.keys(d.paths[path]).some((k) => HTTP_METHODS.includes(k as HttpMethod))) delete d.paths[path];
              });
              props.onDeleted();
            }}
          >
            Delete endpoint
          </button>
        </div>
        <div className="grid-2">
          <Field label="Summary"><input value={op.summary ?? ''} onChange={(e) => set('summary', e.target.value)} /></Field>
          <Field label="Operation ID" hint="Unique name used by code generators, e.g. getOrder">
            <input className="mono" value={op.operationId ?? ''} onChange={(e) => set('operationId', e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea rows={3} value={op.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="row gap-s wrap">
          <Field label="Groups (tags)" hint="Comma separated" className="grow">
            <CommitInput value={(op.tags ?? []).join(', ')} onCommit={(v) => set('tags', v.split(',').map((t) => t.trim()).filter(Boolean))} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={!!op.deprecated} onChange={(e) => set('deprecated', e.target.checked)} /> Deprecated
          </label>
        </div>
      </section>

      <ParametersEditor doc={doc} update={update} base={base} swagger={swagger} />
      {!swagger && <RequestBodyEditor doc={doc} update={update} base={base} />}
      {swagger && op.parameters?.some((p: Doc) => p.in === 'body') && (
        <p className="muted small">This Swagger 2.0 endpoint has a body parameter; edit it via the Raw tab.</p>
      )}
      <ResponsesEditor doc={doc} update={update} base={base} swagger={swagger} />
    </div>
  );
}

function ParametersEditor({ doc, update, base, swagger }: EditorProps & { base: Path; swagger: boolean }) {
  const op: Doc = doc.paths[base[1]][base[2]];
  const params: Doc[] = op.parameters ?? [];
  const pathLevel: Doc[] = doc.paths[base[1]].parameters ?? [];
  const mutate = (i: number, fn: (p: Doc) => void) => update((d) => fn(d.paths[base[1]][base[2]].parameters[i]));

  return (
    <section className="card">
      <h3>Parameters</h3>
      <p className="muted small">Values passed in the URL path, query string or headers.</p>
      {pathLevel.length > 0 && (
        <p className="small muted">Shared with all methods on this path: {pathLevel.map((p) => (p.$ref ? refName(p.$ref) : p.name)).join(', ')}</p>
      )}
      <table className="props-table">
        <thead>
          <tr><th>Name</th><th>Location</th><th>Type</th><th>Required</th><th>Description</th><th /></tr>
        </thead>
        <tbody>
          {params.length === 0 && <tr><td colSpan={6} className="muted small">No parameters.</td></tr>}
          {params.map((p, i) => {
            if (p.$ref) {
              const target = resolveRef(doc, p.$ref);
              return (
                <tr key={i}>
                  <td colSpan={5} className="small">
                    Shared parameter <span className="mono">{refName(p.$ref)}</span>
                    {target && <span className="muted"> ({target.in} · {target.name})</span>}
                  </td>
                  <td className="right"><button className="btn-icon danger" onClick={() => update((d) => { d.paths[base[1]][base[2]].parameters.splice(i, 1); })}>✕</button></td>
                </tr>
              );
            }
            if (p.in === 'body') return null;
            return (
              <tr key={i}>
                <td><input className="mono" value={p.name ?? ''} onChange={(e) => mutate(i, (x) => { x.name = e.target.value; })} /></td>
                <td>
                  <select
                    className="compact"
                    value={p.in}
                    onChange={(e) => mutate(i, (x) => { x.in = e.target.value; if (x.in === 'path') x.required = true; })}
                  >
                    {['path', 'query', 'header', 'cookie'].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </td>
                <td>
                  {swagger ? (
                    <select className="compact" value={p.type ?? 'string'} onChange={(e) => mutate(i, (x) => { x.type = e.target.value; })}>
                      {['string', 'integer', 'number', 'boolean', 'array'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  ) : (
                    <TypePicker compact doc={doc} schema={p.schema} onChange={(s) => mutate(i, (x) => { x.schema = s; })} />
                  )}
                </td>
                <td className="center">
                  <input type="checkbox" checked={!!p.required} disabled={p.in === 'path'} onChange={(e) => mutate(i, (x) => { if (e.target.checked) x.required = true; else delete x.required; })} />
                </td>
                <td>
                  <input value={p.description ?? ''} placeholder="—" onChange={(e) => mutate(i, (x) => { if (e.target.value) x.description = e.target.value; else delete x.description; })} />
                </td>
                <td className="right">
                  <button
                    className="btn-icon danger"
                    onClick={() => update((d) => {
                      const o = d.paths[base[1]][base[2]];
                      o.parameters.splice(i, 1);
                      if (!o.parameters.length) delete o.parameters;
                    })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        className="btn btn-small"
        onClick={() =>
          update((d) => {
            const o = d.paths[base[1]][base[2]];
            o.parameters ??= [];
            o.parameters.push(swagger ? { name: '', in: 'query', type: 'string' } : { name: '', in: 'query', schema: { type: 'string' } });
          })
        }
      >
        + Add parameter
      </button>
    </section>
  );
}

function ContentTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input list="content-types" className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id="content-types">{CONTENT_TYPES.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}

/** Edits the single (first) media type of a `content` map — the common case. Extra media types are listed. */
function ContentEditor({ doc, update, contentPath }: EditorProps & { contentPath: Path }) {
  let content: Doc = doc;
  for (const k of contentPath) content = content?.[k];
  const types = Object.keys(content ?? {});
  const ct = types[0];
  if (!ct) return null;
  return (
    <div className="stack-s">
      <div className="row gap-s">
        <label className="inline">
          Content type
          <CommitInput
            className="mono"
            value={ct}
            validate={(v) => (!v.includes('/') ? 'e.g. application/json' : null)}
            onCommit={(v) => update((d) => {
              let c: Doc = d;
              for (const k of contentPath) c = c[k];
              renameKey(c, ct, v);
            })}
          />
        </label>
        {types.length > 1 && <span className="small muted">Also: {types.slice(1).join(', ')} (edit via Raw)</span>}
      </div>
      <SchemaEditor doc={doc} update={update} path={[...contentPath, ct, 'schema']} />
    </div>
  );
}

function RequestBodyEditor({ doc, update, base }: EditorProps & { base: Path }) {
  const op: Doc = doc.paths[base[1]][base[2]];
  const body: Doc | undefined = op.requestBody;
  const [newCt, setNewCt] = useState('application/json');
  return (
    <section className="card">
      <div className="row space-between">
        <h3>Request body</h3>
        {body && !body.$ref && (
          <button className="btn btn-small btn-danger-ghost" onClick={() => update((d) => { delete d.paths[base[1]][base[2]].requestBody; })}>Remove body</button>
        )}
      </div>
      {!body ? (
        <div className="row gap-s">
          <span className="muted small">This endpoint takes no request body.</span>
          <ContentTypeSelect value={newCt} onChange={setNewCt} />
          <button
            className="btn btn-small"
            onClick={() => update((d) => setIn(d, [...base, 'requestBody'], { required: true, content: { [newCt]: { schema: { type: 'object', properties: {} } } } }))}
          >
            + Add request body
          </button>
        </div>
      ) : body.$ref ? (
        <p className="small">Uses shared request body <span className="mono">{refName(body.$ref)}</span> (edit via Raw).</p>
      ) : (
        <>
          <div className="row gap-s">
            <input className="grow" placeholder="Description" value={body.description ?? ''} onChange={(e) => update((d) => { const b = d.paths[base[1]][base[2]].requestBody; if (e.target.value) b.description = e.target.value; else delete b.description; })} />
            <label className="checkbox"><input type="checkbox" checked={!!body.required} onChange={(e) => update((d) => { const b = d.paths[base[1]][base[2]].requestBody; if (e.target.checked) b.required = true; else delete b.required; })} /> Required</label>
          </div>
          {body.content && Object.keys(body.content).length ? (
            <ContentEditor doc={doc} update={update} contentPath={[...base, 'requestBody', 'content']} />
          ) : (
            <button className="btn btn-small" onClick={() => update((d) => setIn(d, [...base, 'requestBody', 'content'], { 'application/json': { schema: {} } }))}>+ Add content</button>
          )}
        </>
      )}
    </section>
  );
}

function ResponsesEditor({ doc, update, base, swagger }: EditorProps & { base: Path; swagger: boolean }) {
  const op: Doc = doc.paths[base[1]][base[2]];
  const responses: Doc = op.responses ?? {};
  const codes = Object.keys(responses);
  const available = Object.keys(STATUS_CODES).filter((c) => !(c in responses));
  const [newCode, setNewCode] = useState('');
  const respPath = (code: string): Path => [...base, 'responses', code];

  return (
    <section className="card">
      <h3>Responses</h3>
      <p className="muted small">What the API can send back, per HTTP status code.</p>
      {codes.map((code) => {
        const r: Doc = responses[code];
        if (r?.$ref) {
          return (
            <div key={code} className="response">
              <div className="row gap-s">
                <span className={`status status-${code[0]}`}>{code}</span>
                <span className="small">Shared response <span className="mono">{refName(r.$ref)}</span></span>
                <button className="btn-icon danger" onClick={() => update((d) => { delete d.paths[base[1]][base[2]].responses[code]; })}>✕</button>
              </div>
            </div>
          );
        }
        const hasBody = swagger ? !!r.schema : !!r.content && Object.keys(r.content).length > 0;
        return (
          <div key={code} className="response">
            <div className="row gap-s">
              <CommitInput
                className={`status-input status-${code[0]}`}
                value={code}
                validate={(v) => (!/^([1-5][0-9X]{2}|default)$/.test(v) ? '3-digit code or "default"' : v !== code && v in responses ? 'Exists' : null)}
                onCommit={(v) => update((d) => renameKey(d.paths[base[1]][base[2]].responses, code, v))}
              />
              <input className="grow" placeholder="Description (required)" value={r.description ?? ''} onChange={(e) => update((d) => { d.paths[base[1]][base[2]].responses[code].description = e.target.value; })} />
              {!hasBody && (
                <button
                  className="btn btn-small"
                  onClick={() => update((d) => swagger
                    ? setIn(d, [...respPath(code), 'schema'], { type: 'object', properties: {} })
                    : setIn(d, [...respPath(code), 'content'], { 'application/json': { schema: { type: 'object', properties: {} } } }))}
                >
                  + Body
                </button>
              )}
              {hasBody && (
                <button className="btn btn-small btn-ghost" onClick={() => update((d) => { const x = d.paths[base[1]][base[2]].responses[code]; delete x.content; delete x.schema; })}>No body</button>
              )}
              <button className="btn-icon danger" title="Remove response" onClick={() => update((d) => { delete d.paths[base[1]][base[2]].responses[code]; })}>✕</button>
            </div>
            {hasBody && (swagger
              ? <SchemaEditor doc={doc} update={update} path={[...respPath(code), 'schema']} />
              : <ContentEditor doc={doc} update={update} contentPath={[...respPath(code), 'content']} />)}
            {r.headers && <details className="small"><summary>Response headers</summary><JsonNodeEditor value={r.headers} onApply={(v) => update((d) => { d.paths[base[1]][base[2]].responses[code].headers = v; })} /></details>}
          </div>
        );
      })}
      <div className="row gap-s">
        <select value={newCode} onChange={(e) => setNewCode(e.target.value)}>
          <option value="">Add response…</option>
          {available.map((c) => <option key={c} value={c}>{c} {STATUS_CODES[c]}</option>)}
        </select>
        <button
          className="btn btn-small"
          disabled={!newCode}
          onClick={() => {
            update((d) => setIn(d, respPath(newCode), { description: STATUS_CODES[newCode] }));
            setNewCode('');
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
