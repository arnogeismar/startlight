import { isAsyncApi3, type Doc } from '../../lib/contracts';
import { renameKey, uniqueKey } from '../../lib/docEdit';
import { CommitInput, Field } from '../ui';
import type { EditorProps } from './SchemaEditor';

export function InfoEditor({ doc, update }: EditorProps) {
  const info: Doc = doc.info ?? {};
  const setInfo = (key: string, value: string) =>
    update((d) => {
      d.info ??= {};
      if (value) d.info[key] = value;
      else delete d.info[key];
    });
  const setContact = (key: string, value: string) =>
    update((d) => {
      d.info ??= {};
      d.info.contact ??= {};
      if (value) d.info.contact[key] = value;
      else delete d.info.contact[key];
      if (!Object.keys(d.info.contact).length) delete d.info.contact;
    });
  const isOpenApi = doc.openapi !== undefined || doc.swagger !== undefined;

  return (
    <div className="stack">
      <section className="card">
        <h3>General information</h3>
        <div className="grid-2">
          <Field label="API name"><input value={info.title ?? ''} onChange={(e) => setInfo('title', e.target.value)} /></Field>
          <Field label="Version" hint="Bump this when the contract changes, e.g. 1.2.0 → 1.3.0."><input value={info.version ?? ''} onChange={(e) => setInfo('version', e.target.value)} /></Field>
        </div>
        <Field label="Description" hint="Markdown is supported.">
          <textarea rows={5} value={info.description ?? ''} onChange={(e) => setInfo('description', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Contact name"><input value={info.contact?.name ?? ''} onChange={(e) => setContact('name', e.target.value)} /></Field>
          <Field label="Contact email"><input type="email" value={info.contact?.email ?? ''} onChange={(e) => setContact('email', e.target.value)} /></Field>
        </div>
      </section>
      {isOpenApi && !doc.swagger && <OpenApiServers doc={doc} update={update} />}
      {!isOpenApi && <AsyncServers doc={doc} update={update} />}
      {isOpenApi && <Tags doc={doc} update={update} />}
    </div>
  );
}

function OpenApiServers({ doc, update }: EditorProps) {
  const servers: Doc[] = Array.isArray(doc.servers) ? doc.servers : [];
  const set = (i: number, key: string, v: string) => update((d) => { d.servers[i][key] = v; });
  return (
    <section className="card">
      <h3>Servers</h3>
      <p className="muted small">Where the API can be reached (e.g. production, test).</p>
      {servers.map((s, i) => (
        <div className="row gap-s" key={i}>
          <input className="grow mono" placeholder="https://api.example.com" value={s.url ?? ''} onChange={(e) => set(i, 'url', e.target.value)} />
          <input className="grow" placeholder="Description" value={s.description ?? ''} onChange={(e) => set(i, 'description', e.target.value)} />
          <button className="btn-icon danger" onClick={() => update((d) => { d.servers.splice(i, 1); if (!d.servers.length) delete d.servers; })}>✕</button>
        </div>
      ))}
      <button className="btn btn-small" onClick={() => update((d) => { d.servers ??= []; d.servers.push({ url: '', description: '' }); })}>+ Add server</button>
    </section>
  );
}

function AsyncServers({ doc, update }: EditorProps) {
  const servers: Doc = doc.servers ?? {};
  const v3 = isAsyncApi3(doc);
  const set = (name: string, key: string, v: string) => update((d) => { d.servers[name][key] = v; });
  return (
    <section className="card">
      <h3>Servers / brokers</h3>
      <p className="muted small">The message brokers this API uses.</p>
      {Object.entries<Doc>(servers).map(([name, s]) => (
        <div className="row gap-s wrap" key={name}>
          <CommitInput className="mono" value={name} validate={(v) => (v in servers && v !== name ? 'Exists' : !v ? 'Required' : null)} onCommit={(v) => update((d) => renameKey(d.servers, name, v))} />
          <input className="grow mono" placeholder={v3 ? 'broker.example.com:9092' : 'kafka://broker:9092'} value={(v3 ? s.host : s.url) ?? ''} onChange={(e) => set(name, v3 ? 'host' : 'url', e.target.value)} />
          <input placeholder="protocol (kafka, amqp, mqtt…)" value={s.protocol ?? ''} onChange={(e) => set(name, 'protocol', e.target.value)} />
          <input className="grow" placeholder="Description" value={s.description ?? ''} onChange={(e) => set(name, 'description', e.target.value)} />
          <button className="btn-icon danger" onClick={() => update((d) => { delete d.servers[name]; if (!Object.keys(d.servers).length) delete d.servers; })}>✕</button>
        </div>
      ))}
      <button
        className="btn btn-small"
        onClick={() => update((d) => { d.servers ??= {}; d.servers[uniqueKey(d.servers, 'production')] = v3 ? { host: '', protocol: 'kafka' } : { url: '', protocol: 'kafka' }; })}
      >
        + Add server
      </button>
    </section>
  );
}

function Tags({ doc, update }: EditorProps) {
  const tags: Doc[] = Array.isArray(doc.tags) ? doc.tags : [];
  return (
    <section className="card">
      <h3>Tags (endpoint groups)</h3>
      <p className="muted small">Tags group endpoints in the overview and documentation.</p>
      {tags.map((t, i) => (
        <div className="row gap-s" key={i}>
          <input placeholder="Name" value={t.name ?? ''} onChange={(e) => update((d) => { d.tags[i].name = e.target.value; })} />
          <input className="grow" placeholder="Description" value={t.description ?? ''} onChange={(e) => update((d) => { d.tags[i].description = e.target.value; })} />
          <button className="btn-icon danger" onClick={() => update((d) => { d.tags.splice(i, 1); if (!d.tags.length) delete d.tags; })}>✕</button>
        </div>
      ))}
      <button className="btn btn-small" onClick={() => update((d) => { d.tags ??= []; d.tags.push({ name: '', description: '' }); })}>+ Add tag</button>
    </section>
  );
}
