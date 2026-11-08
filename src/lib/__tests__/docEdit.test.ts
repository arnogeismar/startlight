import { describe, expect, it } from 'vitest';
import { convertSchema, countRefs, renameKey, renameRefs, schemaKind, schemaLabel, summarizeChanges, uniqueKey } from '../docEdit';

describe('renameKey', () => {
  it('keeps key order', () => {
    const o = { a: 1, b: 2, c: 3 };
    renameKey(o, 'b', 'x');
    expect(Object.keys(o)).toEqual(['a', 'x', 'c']);
    expect(o).toEqual({ a: 1, x: 2, c: 3 });
  });
});

describe('refs', () => {
  it('renames exact and nested refs only', () => {
    const doc = {
      a: { $ref: '#/components/schemas/Order' },
      b: [{ $ref: '#/components/schemas/OrderLine' }],
      c: { $ref: '#/channels/x/messages/m' },
    };
    renameRefs(doc, '#/components/schemas/Order', '#/components/schemas/PurchaseOrder');
    renameRefs(doc, '#/channels/x', '#/channels/y');
    expect(doc.a.$ref).toBe('#/components/schemas/PurchaseOrder');
    expect(doc.b[0].$ref).toBe('#/components/schemas/OrderLine');
    expect(doc.c.$ref).toBe('#/channels/y/messages/m');
    expect(countRefs(doc, '#/channels/y')).toBe(1);
  });
});

describe('schemas', () => {
  it('classifies and labels', () => {
    expect(schemaKind({ type: ['string', 'null'] })).toBe('string');
    expect(schemaKind({ properties: {} })).toBe('object');
    expect(schemaKind({ oneOf: [] })).toBe('advanced');
    expect(schemaKind({})).toBe('any');
    expect(schemaLabel({ type: 'array', items: { $ref: '#/components/schemas/Order' } })).toBe('list of Order');
  });
  it('converts while keeping the description', () => {
    expect(convertSchema({ type: 'string', description: 'd', format: 'date' }, 'integer')).toEqual({ type: 'integer', description: 'd' });
    expect(convertSchema({ type: 'string' }, 'ref', '#/components/schemas/X')).toEqual({ $ref: '#/components/schemas/X' });
  });
  it('generates unique keys', () => {
    expect(uniqueKey({ NewModel: {}, NewModel2: {} }, 'NewModel')).toBe('NewModel3');
    expect(uniqueKey(undefined, 'A')).toBe('A');
  });
});

describe('summarizeChanges', () => {
  it('reports added, changed and removed endpoints and schemas', () => {
    const before = {
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      paths: { '/a': { get: { responses: {} } }, '/b': { get: { responses: {} } } },
      components: { schemas: { A: { type: 'object' } } },
    };
    const after = {
      ...before,
      paths: { '/a': { get: { summary: 'x', responses: {} } }, '/c': { post: { responses: {} } } },
      components: { schemas: { A: { type: 'object' }, B: { type: 'string' } } },
    };
    expect(summarizeChanges(before, after)).toEqual({
      added: ['Endpoint POST /c', 'Schema B'],
      changed: ['Endpoint GET /a'],
      removed: ['Endpoint GET /b'],
    });
  });
});
