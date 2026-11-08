import { describe, expect, it } from 'vitest';
import {
  detectKind,
  listAsyncOperations,
  listEndpoints,
  looksLikeContract,
  parseContract,
  serializeContract,
  validateContract,
} from '../contracts';

const openapiYaml = `openapi: 3.0.3
info:
  title: Orders
  version: 1.0.0
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      tags: [orders]
      summary: Get an order
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
components:
  schemas:
    Order:
      type: object
      properties:
        id: { type: string }
`;

const async2 = {
  asyncapi: '2.6.0',
  info: { title: 'Events', version: '1' },
  channels: {
    'orders/created': { subscribe: { operationId: 'onCreated', message: { $ref: '#/components/messages/OrderCreated' } } },
  },
  components: { messages: { OrderCreated: { name: 'orderCreated', payload: { type: 'object' } } } },
};

const async3 = {
  asyncapi: '3.0.0',
  info: { title: 'Events', version: '1' },
  channels: {
    orderCreated: { address: 'orders.created', messages: { OrderCreated: { $ref: '#/components/messages/OrderCreated' } } },
  },
  operations: {
    publishOrderCreated: { action: 'send', channel: { $ref: '#/channels/orderCreated' }, summary: 'Emit order created' },
  },
  components: { messages: { OrderCreated: { name: 'OrderCreated', payload: { type: 'object' } } } },
};

describe('detection', () => {
  it('recognises contracts by their version key', () => {
    expect(detectKind({ openapi: '3.1.0' })).toEqual({ kind: 'openapi', specVersion: '3.1.0' });
    expect(detectKind({ swagger: '2.0' })).toEqual({ kind: 'openapi', specVersion: '2.0' });
    expect(detectKind({ asyncapi: '3.0.0' })).toEqual({ kind: 'asyncapi', specVersion: '3.0.0' });
    expect(detectKind({ name: 'package' })).toBeNull();
  });
  it('pre-filters raw text cheaply', () => {
    expect(looksLikeContract(openapiYaml)).toBe(true);
    expect(looksLikeContract('{\n  "asyncapi": "2.6.0"}')).toBe(true);
    expect(looksLikeContract('{"name": "x"}')).toBe(false);
  });
});

describe('parse/serialize', () => {
  it('round-trips YAML and keeps numeric status codes as strings', () => {
    const p = parseContract(openapiYaml, 'api/openapi.yaml');
    expect(p.format).toBe('yaml');
    const out = serializeContract(p.doc, p.format, p.indent);
    expect(parseContract(out, 'x.yaml').doc).toEqual(p.doc);
    expect(Object.keys(p.doc.paths['/orders/{id}'].get.responses)).toEqual(['200']);
  });
  it('keeps JSON indentation', () => {
    const text = JSON.stringify({ openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} }, null, 4) + '\n';
    const p = parseContract(text, 'openapi.json');
    expect(p.indent).toBe(4);
    expect(serializeContract(p.doc, p.format, p.indent)).toBe(text);
  });
  it('rejects non-contracts', () => {
    expect(() => parseContract('{"a":1}', 'a.json')).toThrow();
  });
});

describe('overview extraction', () => {
  it('lists endpoints', () => {
    const { doc } = parseContract(openapiYaml, 'a.yaml');
    expect(listEndpoints(doc)).toEqual([
      { method: 'get', path: '/orders/{id}', summary: 'Get an order', operationId: 'getOrder', tags: ['orders'], deprecated: false },
    ]);
  });
  it('lists AsyncAPI 2 operations', () => {
    expect(listAsyncOperations(async2)).toEqual([
      { id: 'onCreated', action: 'subscribe', channel: 'orders/created', summary: '', messages: ['orderCreated'] },
    ]);
  });
  it('lists AsyncAPI 3 operations with channel address and messages', () => {
    expect(listAsyncOperations(async3)).toEqual([
      { id: 'publishOrderCreated', action: 'send', channel: 'orders.created', summary: 'Emit order created', messages: ['OrderCreated'] },
    ]);
  });
});

describe('validation', () => {
  it('passes a valid document', () => {
    expect(validateContract(parseContract(openapiYaml, 'a.yaml').doc)).toEqual([]);
    expect(validateContract(async3)).toEqual([]);
  });
  it('flags broken refs, duplicate operationIds and undeclared path params', () => {
    const doc = parseContract(openapiYaml, 'a.yaml').doc;
    doc.paths['/orders/{id}'].get.responses['200'].content['application/json'].schema.$ref = '#/components/schemas/Nope';
    doc.paths['/x/{y}'] = { post: { operationId: 'getOrder', responses: { '201': { description: 'ok' } } } };
    const messages = validateContract(doc).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('#/components/schemas/Nope'),
        expect.stringContaining('operationId "getOrder"'),
        expect.stringContaining('"{y}"'),
      ]),
    );
  });
});

describe('YAML formatting preservation', () => {
  it('keeps comments and flow style of untouched parts', () => {
    // Flow-collection padding is applied per file (majority style), so use a consistently styled file.
    const original = openapiYaml.replace('[orders]', '[ orders ]').replace('paths:', '# all endpoints\npaths:');
    const p = parseContract(original, 'a.yaml');
    expect(serializeContract(p.doc, 'yaml', 2, original)).toBe(original);
    const doc = structuredClone(p.doc);
    doc.paths['/orders/{id}'].get.summary = 'Fetch an order';
    doc.paths['/ping'] = { get: { responses: { '200': { description: 'pong' } } } };
    const out = serializeContract(doc, 'yaml', 2, openapiYaml);
    expect(out).toContain('summary: Fetch an order');
    expect(out).toMatch(/schema: \{ type: string \}/);
    expect(out).toContain('/ping:');
    const renamed = structuredClone(p.doc);
    renamed.paths['/orders/{id}'].get.responses['200'].content['application/json'].schema.$ref = '#/components/schemas/X';
    expect(serializeContract(renamed, 'yaml', 2, openapiYaml)).toContain("$ref: '#/components/schemas/X'");
    expect(parseContract(out, 'a.yaml').doc).toEqual(doc);
  });
});
