import { useState } from 'react';
import { isAsyncApi3, refName, resolveRef, type Doc } from '../../lib/contracts';
import { countRefs, escapePointer, renameKey, renameRefs, uniqueKey } from '../../lib/docEdit';
import { ActionBadge, CommitInput, Field } from '../ui';
import { ListDetail } from './ListDetail';
import { SchemaEditor, type EditorProps } from './SchemaEditor';

const MSG_PREFIX = '#/components/messages/';
const msgRef = (name: string) => MSG_PREFIX + escapePointer(name);
const chanRef = (name: string) => '#/channels/' + escapePointer(name);
const keyRule = (existing: Doc, current: string) => (v: string) =>
  !v.trim() ? 'Required' : v !== current && v in existing ? 'Already exists' : null;

function messageNames(doc: Doc): string[] {
  return Object.keys(doc.components?.messages ?? {});
}

function ensureMessage(d: Doc): string {
  d.components ??= {};
  d.components.messages ??= {};
  const name = uniqueKey(d.components.messages, 'NewMessage');
  d.components.messages[name] = { name, contentType: 'application/json', payload: { type: 'object', properties: {} } };
  return name;
}

// ---------------------------------------------------------------------------
// Messages (shared by v2 and v3)
// ---------------------------------------------------------------------------

export function MessagesSection({ doc, update }: EditorProps) {
  const messages: Doc = doc.components?.messages ?? {};
  const names = Object.keys(messages);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const current = selected && selected in messages ? selected : null;
  const m: Doc | undefined = current ? messages[current] : undefined;
  const usages = current ? countRefs(doc, msgRef(current)) : 0;
  const set = (key: string, v: string) =>
    update((d) => {
      const x = d.components.messages[current!];
      if (v) x[key] = v;
      else delete x[key];
    });

  return (
    <ListDetail
      items={names.map((n) => ({ key: n, label: <span className="mono">{n}</span>, search: `${n} ${messages[n]?.title ?? ''}` }))}
      selected={current}
      onSelect={setSelected}
      onAdd={() => {
        let name = '';
        update((d) => { name = ensureMessage(d); }); // update() applies synchronously
        setSelected(name);
      }}
      addLabel="+ New message"
      empty="Messages describe what is sent over a channel. Select one or create a new one."
    >
      {current && m && (
        <div className="stack">
          <section className="card">
            <div className="row gap-s space-between">
              <Field label="Message id" hint={usages ? `Used in ${usages} place(s); renaming updates them.` : 'Not used by any channel yet.'}>
                <CommitInput
                  className="mono"
                  value={current}
                  validate={keyRule(messages, current)}
                  onCommit={(v) => {
                    update((d) => {
                      renameKey(d.components.messages, current, v);
                      renameRefs(d, msgRef(current), msgRef(v));
                    });
                    setSelected(v);
                  }}
                />
              </Field>
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  if (usages && !confirm(`${current} is used in ${usages} place(s). Delete anyway?`)) return;
                  update((d) => { delete d.components.messages[current]; });
                  setSelected(null);
                }}
              >
                Delete message
              </button>
            </div>
            {m.$ref ? (
              <p className="small">Points to <span className="mono">{m.$ref}</span>.</p>
            ) : (
              <>
                <div className="grid-2">
                  <Field label="Name"><input value={m.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
                  <Field label="Title"><input value={m.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
                  <Field label="Summary"><input value={m.summary ?? ''} onChange={(e) => set('summary', e.target.value)} /></Field>
                  <Field label="Content type"><input className="mono" value={m.contentType ?? ''} placeholder="application/json" onChange={(e) => set('contentType', e.target.value)} /></Field>
                </div>
                <Field label="Description"><textarea rows={2} value={m.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
              </>
            )}
          </section>
          {!m.$ref && (
            <section className="card">
              <h3>Payload</h3>
              <p className="muted small">The data carried by this message.</p>
              <SchemaEditor doc={doc} update={update} path={['components', 'messages', current, 'payload']} />
            </section>
          )}
        </div>
      )}
    </ListDetail>
  );
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export function ChannelsSection(props: EditorProps) {
  return isAsyncApi3(props.doc) ? <ChannelsV3 {...props} /> : <ChannelsV2 {...props} />;
}

function ChannelsV3({ doc, update }: EditorProps) {
  const channels: Doc = doc.channels ?? {};
  const names = Object.keys(channels);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const current = selected && selected in channels ? selected : null;
  const ch: Doc | undefined = current ? channels[current] : undefined;
  const allMessages = messageNames(doc);

  return (
    <ListDetail
      items={names.map((n) => ({ key: n, label: <><span className="mono">{n}</span><span className="small muted"> {channels[n]?.address ?? ''}</span></>, search: `${n} ${channels[n]?.address ?? ''}` }))}
      selected={current}
      onSelect={setSelected}
      onAdd={() => {
        const name = uniqueKey(channels, 'newChannel');
        update((d) => { d.channels ??= {}; d.channels[name] = { address: 'new.topic', messages: {} }; });
        setSelected(name);
      }}
      addLabel="+ New channel"
      empty="Channels are the topics / queues messages flow through."
    >
      {current && ch && (
        <section className="card stack">
          <div className="row gap-s space-between">
            <Field label="Channel id">
              <CommitInput
                className="mono"
                value={current}
                validate={keyRule(channels, current)}
                onCommit={(v) => {
                  update((d) => {
                    renameKey(d.channels, current, v);
                    renameRefs(d, chanRef(current), chanRef(v));
                  });
                  setSelected(v);
                }}
              />
            </Field>
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                const n = countRefs(doc, chanRef(current));
                if (n && !confirm(`${n} operation reference(s) use this channel. Delete anyway?`)) return;
                update((d) => { delete d.channels[current]; });
                setSelected(null);
              }}
            >
              Delete channel
            </button>
          </div>
          <Field label="Address" hint="The topic / queue name on the broker. Use {param} for variable parts.">
            <input className="mono" value={ch.address ?? ''} onChange={(e) => update((d) => { d.channels[current].address = e.target.value; })} />
          </Field>
          <Field label="Description">
            <textarea rows={2} value={ch.description ?? ''} onChange={(e) => update((d) => { if (e.target.value) d.channels[current].description = e.target.value; else delete d.channels[current].description; })} />
          </Field>
          <div>
            <div className="field-label">Messages on this channel</div>
            {allMessages.length === 0 && <p className="muted small">Create a message first under "Messages".</p>}
            <div className="checkbox-grid">
              {allMessages.map((name) => {
                const entry = Object.entries<Doc>(ch.messages ?? {}).find(([, v]) => v?.$ref === msgRef(name));
                return (
                  <label key={name} className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!entry}
                      onChange={(e) =>
                        update((d) => {
                          const c = d.channels[current];
                          c.messages ??= {};
                          if (e.target.checked) c.messages[uniqueKey(c.messages, name)] = { $ref: msgRef(name) };
                          else if (entry) {
                            delete c.messages[entry[0]];
                            // Drop operation references to the removed channel message.
                            const ref = `${chanRef(current)}/messages/${escapePointer(entry[0])}`;
                            for (const op of Object.values<Doc>(d.operations ?? {})) {
                              if (Array.isArray(op.messages)) op.messages = op.messages.filter((m: Doc) => m.$ref !== ref);
                            }
                          }
                        })
                      }
                    />
                    <span className="mono">{name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </ListDetail>
  );
}

function ChannelsV2({ doc, update }: EditorProps) {
  const channels: Doc = doc.channels ?? {};
  const names = Object.keys(channels);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const current = selected && selected in channels ? selected : null;
  const ch: Doc | undefined = current ? channels[current] : undefined;

  return (
    <ListDetail
      items={names.map((n) => ({
        key: n,
        search: n,
        label: (
          <span className="endpoint-item">
            {channels[n]?.publish && <ActionBadge action="publish" />}
            {channels[n]?.subscribe && <ActionBadge action="subscribe" />}
            <span className="mono">{n}</span>
          </span>
        ),
      }))}
      selected={current}
      onSelect={setSelected}
      onAdd={() => {
        const name = uniqueKey(channels, 'new/topic');
        update((d) => { d.channels ??= {}; d.channels[name] = { description: '' }; });
        setSelected(name);
      }}
      addLabel="+ New channel"
      empty="Channels are the topics / queues messages flow through."
    >
      {current && ch && (
        <div className="stack">
          <section className="card">
            <div className="row gap-s space-between">
              <Field label="Channel (topic / queue name)" className="grow">
                <CommitInput className="mono" value={current} validate={keyRule(channels, current)} onCommit={(v) => { update((d) => renameKey(d.channels, current, v)); setSelected(v); }} />
              </Field>
              <button className="btn btn-danger-ghost" onClick={() => { update((d) => { delete d.channels[current]; }); setSelected(null); }}>Delete channel</button>
            </div>
            <Field label="Description">
              <textarea rows={2} value={ch.description ?? ''} onChange={(e) => update((d) => { if (e.target.value) d.channels[current].description = e.target.value; else delete d.channels[current].description; })} />
            </Field>
          </section>
          {(['subscribe', 'publish'] as const).map((action) => (
            <V2Operation key={action} doc={doc} update={update} channel={current} action={action} />
          ))}
        </div>
      )}
    </ListDetail>
  );
}

function V2Operation({ doc, update, channel, action }: EditorProps & { channel: string; action: 'publish' | 'subscribe' }) {
  const op: Doc | undefined = doc.channels[channel][action];
  const names = messageNames(doc);
  const help = action === 'subscribe'
    ? 'The application sends messages on this channel (others subscribe to them).'
    : 'The application receives messages on this channel (others publish them).';
  const set = (key: string, v: string) =>
    update((d) => {
      const o = d.channels[channel][action];
      if (v) o[key] = v;
      else delete o[key];
    });
  const msg: Doc | undefined = op?.message;
  const mode = !msg ? 'none' : msg.$ref ? 'ref' : msg.oneOf ? 'oneOf' : 'inline';

  return (
    <section className="card">
      <div className="row space-between">
        <h3><ActionBadge action={action} /> {action === 'subscribe' ? 'Sends' : 'Receives'}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!op}
            onChange={(e) =>
              update((d) => {
                if (e.target.checked) d.channels[channel][action] = { operationId: '', summary: '', ...(names[0] ? { message: { $ref: msgRef(names[0]) } } : {}) };
                else delete d.channels[channel][action];
              })
            }
          />
          Enabled
        </label>
      </div>
      <p className="muted small">{help}</p>
      {op && (
        <>
          <div className="grid-2">
            <Field label="Operation ID"><input className="mono" value={op.operationId ?? ''} onChange={(e) => set('operationId', e.target.value)} /></Field>
            <Field label="Summary"><input value={op.summary ?? ''} onChange={(e) => set('summary', e.target.value)} /></Field>
          </div>
          <Field label="Message">
            <select
              value={mode === 'ref' ? msg!.$ref : mode}
              onChange={(e) =>
                update((d) => {
                  const o = d.channels[channel][action];
                  const v = e.target.value;
                  if (v === '__new') {
                    const name = ensureMessage(d);
                    o.message = { $ref: msgRef(name) };
                  } else if (v === 'inline') o.message = { payload: { type: 'object', properties: {} } };
                  else if (v === 'oneOf' || v === 'none') return;
                  else o.message = { $ref: v };
                })
              }
            >
              {mode === 'none' && <option value="none">— choose —</option>}
              {mode === 'oneOf' && <option value="oneOf">Multiple messages (edit via Raw)</option>}
              {names.map((n) => <option key={n} value={msgRef(n)}>{n}</option>)}
              <option value="inline">Define payload here</option>
              <option value="__new">+ Create new shared message</option>
            </select>
          </Field>
          {mode === 'inline' && <SchemaEditor doc={doc} update={update} path={['channels', channel, action, 'message', 'payload']} />}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Operations (AsyncAPI 3)
// ---------------------------------------------------------------------------

export function OperationsSection({ doc, update }: EditorProps) {
  const ops: Doc = doc.operations ?? {};
  const names = Object.keys(ops);
  const channels: Doc = doc.channels ?? {};
  const channelNames = Object.keys(channels);
  const [selected, setSelected] = useState<string | null>(names[0] ?? null);
  const current = selected && selected in ops ? selected : null;
  const op: Doc | undefined = current ? ops[current] : undefined;
  const chName = op?.channel?.$ref ? refName(op.channel.$ref) : '';
  const ch: Doc | undefined = op?.channel?.$ref ? resolveRef(doc, op.channel.$ref) : undefined;
  const set = (key: string, v: unknown) =>
    update((d) => {
      const o = d.operations[current!];
      if (v === '' || v === undefined) delete o[key];
      else o[key] = v;
    });

  return (
    <ListDetail
      items={names.map((n) => ({
        key: n,
        search: `${n} ${ops[n]?.summary ?? ''}`,
        label: (
          <span className="endpoint-item">
            <ActionBadge action={ops[n]?.action ?? 'send'} />
            <span className="mono">{n}</span>
          </span>
        ),
      }))}
      selected={current}
      onSelect={setSelected}
      onAdd={
        channelNames.length
          ? () => {
              const name = uniqueKey(ops, 'newOperation');
              update((d) => { d.operations ??= {}; d.operations[name] = { action: 'send', channel: { $ref: chanRef(channelNames[0]) } }; });
              setSelected(name);
            }
          : undefined
      }
      addLabel="+ New operation"
      empty={channelNames.length ? 'Operations say whether the application sends or receives on a channel.' : 'Create a channel first, then add operations to it.'}
    >
      {current && op && (
        <section className="card stack">
          <div className="row gap-s space-between">
            <Field label="Operation id">
              <CommitInput
                className="mono"
                value={current}
                validate={keyRule(ops, current)}
                onCommit={(v) => {
                  update((d) => {
                    renameKey(d.operations, current, v);
                    renameRefs(d, '#/operations/' + escapePointer(current), '#/operations/' + escapePointer(v));
                  });
                  setSelected(v);
                }}
              />
            </Field>
            <button className="btn btn-danger-ghost" onClick={() => { update((d) => { delete d.operations[current]; }); setSelected(null); }}>Delete operation</button>
          </div>
          <div className="grid-2">
            <Field label="The application…">
              <div className="segmented">
                <button className={op.action === 'send' ? 'active' : ''} onClick={() => set('action', 'send')}>sends</button>
                <button className={op.action === 'receive' ? 'active' : ''} onClick={() => set('action', 'receive')}>receives</button>
              </div>
            </Field>
            <Field label="Channel">
              <select
                value={chName}
                onChange={(e) =>
                  update((d) => {
                    d.operations[current].channel = { $ref: chanRef(e.target.value) };
                    delete d.operations[current].messages; // messages are channel-specific
                  })
                }
              >
                {!chName && <option value="">— choose —</option>}
                {channelNames.map((c) => <option key={c} value={c}>{c} ({channels[c]?.address})</option>)}
              </select>
            </Field>
          </div>
          <Field label="Summary"><input value={op.summary ?? ''} onChange={(e) => set('summary', e.target.value)} /></Field>
          <Field label="Description"><textarea rows={2} value={op.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
          {ch && (
            <div>
              <div className="field-label">Messages (leave all unchecked to use every message on the channel)</div>
              <div className="checkbox-grid">
                {Object.keys(ch.messages ?? {}).map((mk) => {
                  const ref = `${chanRef(chName)}/messages/${escapePointer(mk)}`;
                  const checked = Array.isArray(op.messages) && op.messages.some((m: Doc) => m.$ref === ref);
                  return (
                    <label key={mk} className="checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          update((d) => {
                            const o = d.operations[current];
                            const list: Doc[] = (o.messages ?? []).filter((m: Doc) => m.$ref !== ref);
                            if (e.target.checked) list.push({ $ref: ref });
                            if (list.length) o.messages = list;
                            else delete o.messages;
                          })
                        }
                      />
                      <span className="mono">{mk}</span>
                    </label>
                  );
                })}
                {!Object.keys(ch.messages ?? {}).length && <span className="muted small">This channel has no messages yet.</span>}
              </div>
            </div>
          )}
        </section>
      )}
    </ListDetail>
  );
}
