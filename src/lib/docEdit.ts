import { getIn, ensureIn, listEndpoints, listAsyncOperations, schemaContainer, refName, isAsyncApi3, type Doc } from './contracts';

export type Path = string[];

export function setIn(doc: Doc, path: Path, value: unknown): void {
  const parent = ensureIn(doc, path.slice(0, -1));
  parent[path[path.length - 1]] = value;
}

export function deleteIn(doc: Doc, path: Path): void {
  const parent = getIn(doc, path.slice(0, -1));
  if (!parent) return;
  const key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
}

/** Renames a key in an object while keeping its position (key order matters to humans reading the file). */
export function renameKey(obj: Doc, from: string, to: string): void {
  if (from === to || !(from in obj)) return;
  const entries = Object.entries(obj);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k === from ? to : k] = v;
}

export const escapePointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Rewrites every local $ref equal to `from` or nested under it (`from/...`) to start with `to` instead. */
export function renameRefs(node: unknown, from: string, to: string): void {
  if (Array.isArray(node)) node.forEach((n) => renameRefs(n, from, to));
  else if (node && typeof node === 'object') {
    const o = node as Doc;
    for (const [k, v] of Object.entries(o)) {
      if (k === '$ref' && typeof v === 'string') {
        if (v === from) o[k] = to;
        else if (v.startsWith(from + '/')) o[k] = to + v.slice(from.length);
      } else renameRefs(v, from, to);
    }
  }
}

export function countRefs(node: unknown, ref: string): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countRefs(x, ref), 0);
  if (node && typeof node === 'object') {
    return Object.entries(node).reduce(
      (n, [k, v]) => n + (k === '$ref' && typeof v === 'string' && (v === ref || v.startsWith(ref + '/')) ? 1 : countRefs(v, ref)),
      0,
    );
  }
  return 0;
}

export function uniqueKey(obj: Doc | undefined, base: string): string {
  if (!obj || !(base in obj)) return base;
  for (let i = 2; ; i++) if (!(`${base}${i}` in obj)) return `${base}${i}`;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

export type SchemaKind = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'ref' | 'any' | 'advanced';

export function schemaKind(s: Doc | undefined): SchemaKind {
  if (!s || typeof s !== 'object') return 'any';
  if (s.$ref) return 'ref';
  if (s.allOf || s.oneOf || s.anyOf || s.not) return 'advanced';
  const t = Array.isArray(s.type) ? s.type.find((x: string) => x !== 'null') : s.type;
  if (['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(t)) return t;
  if (s.properties) return 'object';
  if (s.items) return 'array';
  return Object.keys(s).filter((k) => !['description', 'title', 'example', 'examples'].includes(k)).length ? 'advanced' : 'any';
}

export function schemaLabel(s: Doc | undefined): string {
  const kind = schemaKind(s);
  if (!s) return 'any';
  switch (kind) {
    case 'ref':
      return refName(s.$ref);
    case 'array':
      return `list of ${schemaLabel(s.items)}`;
    case 'string':
    case 'number':
    case 'integer':
      return s.format ? `${kind} (${s.format})` : s.enum ? `${kind} (one of ${s.enum.length})` : kind;
    case 'advanced':
      return s.oneOf ? 'one of…' : s.anyOf ? 'any of…' : s.allOf ? 'combination' : 'custom';
    default:
      return kind;
  }
}

/** Returns a schema of the new kind, keeping only properties that still make sense. */
export function convertSchema(s: Doc | undefined, kind: SchemaKind, refTarget?: string): Doc {
  const keep: Doc = {};
  if (s?.description && kind !== 'ref') keep.description = s.description;
  switch (kind) {
    case 'ref':
      return { $ref: refTarget ?? '' };
    case 'object':
      return { type: 'object', ...keep, properties: s?.properties ?? {}, ...(s?.required ? { required: s.required } : {}) };
    case 'array':
      return { type: 'array', ...keep, items: s?.items ?? { type: 'string' } };
    case 'any':
      return keep;
    case 'advanced':
      return { ...keep, oneOf: [s && schemaKind(s) !== 'any' ? s : { type: 'string' }] };
    default:
      return { type: kind, ...keep };
  }
}

// ---------------------------------------------------------------------------
// Human-readable change summary (save dialog + pull request body)
// ---------------------------------------------------------------------------

export interface ChangeSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

function diffMaps(before: Map<string, string>, after: Map<string, string>): ChangeSummary {
  const out: ChangeSummary = { added: [], removed: [], changed: [] };
  for (const [k, v] of after) {
    if (!before.has(k)) out.added.push(k);
    else if (before.get(k) !== v) out.changed.push(k);
  }
  for (const k of before.keys()) if (!after.has(k)) out.removed.push(k);
  return out;
}

function itemsOf(doc: Doc | null): Map<string, string> {
  const m = new Map<string, string>();
  if (!doc) return m;
  if (doc.openapi !== undefined || doc.swagger !== undefined) {
    for (const e of listEndpoints(doc)) m.set(`Endpoint ${e.method.toUpperCase()} ${e.path}`, JSON.stringify(doc.paths[e.path][e.method]));
  } else {
    for (const o of listAsyncOperations(doc)) m.set(`Operation ${o.action} ${o.channel}${isAsyncApi3(doc) ? ` (${o.id})` : ''}`, JSON.stringify(o));
    for (const [k, v] of Object.entries<Doc>(doc.channels ?? {})) m.set(`Channel ${v?.address ?? k}`, JSON.stringify(v));
    for (const [k, v] of Object.entries<Doc>(doc.components?.messages ?? {})) m.set(`Message ${k}`, JSON.stringify(v));
  }
  for (const [k, v] of Object.entries<Doc>(getIn(doc, schemaContainer(doc).path) ?? {})) m.set(`Schema ${k}`, JSON.stringify(v));
  if (doc.info) m.set('General information', JSON.stringify({ ...doc.info, servers: doc.servers, tags: doc.tags }));
  return m;
}

export function summarizeChanges(before: Doc | null, after: Doc): ChangeSummary {
  return diffMaps(itemsOf(before), itemsOf(after));
}

export function changeSummaryMarkdown(s: ChangeSummary): string {
  const lines: string[] = [];
  for (const a of s.added) lines.push(`- ➕ Added ${a}`);
  for (const c of s.changed) lines.push(`- ✏️ Changed ${c}`);
  for (const r of s.removed) lines.push(`- ➖ Removed ${r}`);
  return lines.join('\n');
}
