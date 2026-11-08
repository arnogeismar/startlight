import YAML from 'yaml';

export type ContractKind = 'openapi' | 'asyncapi';
export type FileFormat = 'json' | 'yaml';
// Contract documents are free-form JSON; editors treat them as loosely typed trees.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;

export interface ParsedContract {
  doc: Doc;
  kind: ContractKind;
  specVersion: string;
  format: FileFormat;
  indent: number;
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const formatFromPath = (path: string): FileFormat => (/\.ya?ml$/i.test(path) ? 'yaml' : 'json');

/** Cheap check on raw text so the scanner can skip files without fully parsing them. */
export function looksLikeContract(text: string): boolean {
  return /^\s*["']?(openapi|swagger|asyncapi)["']?\s*:/m.test(text.slice(0, 4096));
}

export function detectKind(doc: unknown): { kind: ContractKind; specVersion: string } | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Doc;
  if (typeof d.openapi === 'string' || typeof d.openapi === 'number') return { kind: 'openapi', specVersion: String(d.openapi) };
  if (d.swagger !== undefined) return { kind: 'openapi', specVersion: String(d.swagger) };
  if (d.asyncapi !== undefined) return { kind: 'asyncapi', specVersion: String(d.asyncapi) };
  return null;
}

function detectIndent(text: string): number {
  const m = text.match(/^\n?( +)\S/m) ?? text.match(/\n( +)\S/);
  return m ? Math.min(m[1].length, 8) : 2;
}

export function parseContract(text: string, path: string): ParsedContract {
  const format = formatFromPath(path);
  const doc = format === 'json' ? JSON.parse(text) : YAML.parse(text);
  const detected = detectKind(doc);
  if (!detected) throw new Error(`${path} is not an OpenAPI or AsyncAPI document`);
  return { doc, ...detected, format, indent: detectIndent(text) };
}

/**
 * Serializes a contract. For YAML, pass the file's current text as `baseText`:
 * the new values are patched into the original document so untouched parts keep
 * their comments, quoting and flow style, keeping pull request diffs small.
 */
export function serializeContract(doc: Doc, format: FileFormat, indent = 2, baseText?: string): string {
  if (format === 'json') return JSON.stringify(doc, null, indent) + '\n';
  const opts = { indent, lineWidth: 0 };
  if (baseText) {
    try {
      const ydoc = YAML.parseDocument(baseText);
      if (!ydoc.errors.length) {
        ydoc.contents = patchYamlNode(ydoc, ydoc.contents, doc) as typeof ydoc.contents;
        // Match the file's existing style: `[a, b]` vs `[ a, b ]`.
        const padded = (baseText.match(/[[{] [^\s\]}]/g) ?? []).length;
        const tight = (baseText.match(/[[{][^\s\]}]/g) ?? []).length;
        return ydoc.toString({ ...opts, flowCollectionPadding: padded >= tight });
      }
    } catch {
      /* fall back to a fresh dump */
    }
  }
  return YAML.stringify(doc, { ...opts, aliasDuplicateObjects: false });
}

const sameValue = (node: unknown, value: unknown, ydoc: YAML.Document) =>
  YAML.isNode(node) && JSON.stringify(node.toJS(ydoc)) === JSON.stringify(value);

function patchYamlNode(ydoc: YAML.Document, node: unknown, value: unknown): unknown {
  if (YAML.isMap(node) && value && typeof value === 'object' && !Array.isArray(value)) {
    const byKey = new Map(node.items.map((p) => [String(YAML.isScalar(p.key) ? p.key.value : p.key), p]));
    node.items = Object.entries(value).map(([k, v]) => {
      const pair = byKey.get(k);
      if (!pair) return ydoc.createPair(k, v);
      pair.value = patchYamlNode(ydoc, pair.value, v);
      return pair;
    });
    return node;
  }
  if (YAML.isSeq(node) && Array.isArray(value)) {
    node.items = value.map((v, i) => (i < node.items.length ? patchYamlNode(ydoc, node.items[i], v) : ydoc.createNode(v)));
    return node;
  }
  if (sameValue(node, value, ydoc)) return node; // scalars & aliases that didn't change keep their style
  if (YAML.isScalar(node) && value !== null && typeof value !== 'object' && typeof value === typeof node.value) {
    node.value = value; // changed scalar of the same type: keep its quoting style
    return node;
  }
  return ydoc.createNode(value);
}

export const isSwagger2 = (doc: Doc) => doc.swagger !== undefined;
export const isAsyncApi3 = (doc: Doc) => String(doc.asyncapi ?? '').startsWith('3');

/** Where reusable schemas live for this document type. */
export function schemaContainer(doc: Doc): { path: string[]; refPrefix: string } {
  if (isSwagger2(doc)) return { path: ['definitions'], refPrefix: '#/definitions/' };
  return { path: ['components', 'schemas'], refPrefix: '#/components/schemas/' };
}

export function getIn(obj: Doc | undefined, path: string[]): Doc | undefined {
  return path.reduce<Doc | undefined>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** Like getIn, but creates missing objects (for use inside immer drafts). */
export function ensureIn(obj: Doc, path: string[]): Doc {
  return path.reduce<Doc>((o, k) => {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    return o[k];
  }, obj);
}

export function resolveRef(doc: Doc, ref: string): Doc | undefined {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~')));
  return getIn(doc, parts);
}

export const refName = (ref: string) => decodeURIComponent(ref.split('/').pop() ?? ref);

// ---------------------------------------------------------------------------
// Overview extraction
// ---------------------------------------------------------------------------

export interface Endpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  operationId: string;
  tags: string[];
  deprecated: boolean;
}

export function listEndpoints(doc: Doc): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries<Doc>(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      out.push({
        method,
        path,
        summary: op.summary ?? op.description?.split('\n')[0] ?? '',
        operationId: op.operationId ?? '',
        tags: Array.isArray(op.tags) && op.tags.length ? op.tags : [],
        deprecated: Boolean(op.deprecated),
      });
    }
  }
  return out;
}

export type AsyncAction = 'send' | 'receive' | 'publish' | 'subscribe';

export interface AsyncOperation {
  id: string;
  action: AsyncAction;
  channel: string;
  summary: string;
  messages: string[];
}

function messageLabel(doc: Doc, m: Doc | undefined): string[] {
  if (!m) return [];
  if (m.$ref) {
    const target = resolveRef(doc, m.$ref);
    return [target?.name ?? target?.title ?? refName(m.$ref)];
  }
  if (Array.isArray(m.oneOf)) return m.oneOf.flatMap((x: Doc) => messageLabel(doc, x));
  return [m.name ?? m.title ?? 'inline message'];
}

export function listAsyncOperations(doc: Doc): AsyncOperation[] {
  const out: AsyncOperation[] = [];
  if (isAsyncApi3(doc)) {
    for (const [id, op] of Object.entries<Doc>(doc.operations ?? {})) {
      if (!op || typeof op !== 'object') continue;
      const channelRef: string = op.channel?.$ref ?? '';
      const channel = resolveRef(doc, channelRef);
      const msgs: Doc[] = Array.isArray(op.messages) && op.messages.length
        ? op.messages
        : Object.values<Doc>(channel?.messages ?? {});
      out.push({
        id,
        action: op.action === 'receive' ? 'receive' : 'send',
        channel: channel?.address ?? refName(channelRef),
        summary: op.summary ?? op.description?.split('\n')[0] ?? '',
        messages: msgs.flatMap((m) => messageLabel(doc, m.$ref ? resolveRef(doc, m.$ref) ?? m : m)),
      });
    }
    return out;
  }
  for (const [name, ch] of Object.entries<Doc>(doc.channels ?? {})) {
    if (!ch || typeof ch !== 'object') continue;
    for (const action of ['publish', 'subscribe'] as const) {
      const op = ch[action];
      if (!op) continue;
      out.push({
        id: op.operationId ?? `${action} ${name}`,
        action,
        channel: name,
        summary: op.summary ?? op.description?.split('\n')[0] ?? '',
        messages: messageLabel(doc, op.message),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation (lightweight, aimed at catching the mistakes form-editing can make)
// ---------------------------------------------------------------------------

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

function collectRefs(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, acc));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') acc.push(v);
      else collectRefs(v, acc);
    }
  }
  return acc;
}

export function validateContract(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const kind = detectKind(doc);
  if (!kind) return [{ level: 'error', message: 'Document is missing the openapi/swagger/asyncapi version field.' }];
  if (!doc.info?.title) issues.push({ level: 'error', message: 'info.title is required.' });
  if (!doc.info?.version) issues.push({ level: 'error', message: 'info.version is required.' });

  for (const ref of collectRefs(doc)) {
    if (ref.startsWith('#/') && resolveRef(doc, ref) === undefined) {
      issues.push({ level: 'error', message: `Reference ${ref} does not point to anything.` });
    }
  }

  if (kind.kind === 'openapi') {
    const seen = new Map<string, string>();
    for (const path of Object.keys(doc.paths ?? {})) {
      if (!path.startsWith('/')) issues.push({ level: 'error', message: `Path "${path}" must start with "/".` });
    }
    for (const ep of listEndpoints(doc)) {
      const where = `${ep.method.toUpperCase()} ${ep.path}`;
      if (ep.operationId) {
        if (seen.has(ep.operationId)) {
          issues.push({ level: 'error', message: `operationId "${ep.operationId}" is used by both ${seen.get(ep.operationId)} and ${where}.` });
        }
        seen.set(ep.operationId, where);
      }
      const op = doc.paths[ep.path][ep.method];
      if (!op.responses || !Object.keys(op.responses).length) {
        issues.push({ level: 'error', message: `${where} has no responses.` });
      }
      const declared = new Set(
        [...(doc.paths[ep.path].parameters ?? []), ...(op.parameters ?? [])]
          .map((p: Doc) => (p.$ref ? resolveRef(doc, p.$ref) : p))
          .filter((p: Doc | undefined): p is Doc => p?.in === 'path')
          .map((p: Doc) => p.name),
      );
      for (const m of ep.path.matchAll(/\{([^}]+)\}/g)) {
        if (!declared.has(m[1])) issues.push({ level: 'warning', message: `${where}: path parameter "{${m[1]}}" is not declared.` });
      }
    }
  } else {
    const ops = listAsyncOperations(doc);
    if (!Object.keys(doc.channels ?? {}).length) issues.push({ level: 'warning', message: 'No channels defined.' });
    if (isAsyncApi3(doc)) {
      for (const [id, op] of Object.entries<Doc>(doc.operations ?? {})) {
        if (!op.channel?.$ref) issues.push({ level: 'error', message: `Operation "${id}" has no channel.` });
        if (op.action !== 'send' && op.action !== 'receive') issues.push({ level: 'error', message: `Operation "${id}" must have action send or receive.` });
      }
    }
    if (!ops.length) issues.push({ level: 'warning', message: 'No operations defined.' });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Templates for new contracts
// ---------------------------------------------------------------------------

export function newContractTemplate(kind: ContractKind, title: string): Doc {
  if (kind === 'openapi') {
    return {
      openapi: '3.1.0',
      info: { title, version: '0.1.0', description: '' },
      paths: {},
      components: { schemas: {} },
    };
  }
  return {
    asyncapi: '3.0.0',
    info: { title, version: '0.1.0', description: '' },
    channels: {},
    operations: {},
    components: { messages: {}, schemas: {} },
  };
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
