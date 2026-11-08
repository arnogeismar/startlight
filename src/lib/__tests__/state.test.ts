import { describe, expect, it } from 'vitest';
import { canEdit, isAdmin, validateState, type AppState } from '../state';
import { candidateFiles } from '../scan';
import { isValidBranchName, parseRepo, encodeBase64Utf8, decodeBase64Utf8 } from '../github';

const state: AppState = {
  schemaVersion: 1,
  admins: ['Alice'],
  projects: [{ owner: 'acme', repo: 'orders', addedBy: 'alice', addedAt: '', editors: ['bob'] }],
};

describe('permissions', () => {
  it('admins edit everything, editors only their repos, everyone else reads', () => {
    expect(isAdmin(state, 'alice')).toBe(true);
    expect(canEdit(state, 'alice', { owner: 'acme', repo: 'other' })).toBe(true);
    expect(canEdit(state, 'BOB', { owner: 'Acme', repo: 'Orders' })).toBe(true);
    expect(canEdit(state, 'bob', { owner: 'acme', repo: 'other' })).toBe(false);
    expect(canEdit(state, 'carol', { owner: 'acme', repo: 'orders' })).toBe(false);
  });
  it('validates the state file shape', () => {
    expect(() => validateState({ admins: 'x' })).toThrow();
    expect(validateState({ admins: ['a'], projects: [{ owner: 'o', repo: 'r' }] }).projects[0].editors).toEqual([]);
  });
});

describe('scanner candidate selection', () => {
  it('skips tooling files and vendored folders', () => {
    const files = ['api/openapi.yaml', 'package.json', 'node_modules/x/openapi.json', 'docs/asyncapi.yml', 'src/a.ts', 'tsconfig.app.json', 'helm/values-prod.yaml']
      .map((path) => ({ path, sha: path, size: 10 }));
    expect(candidateFiles(files).map((f) => f.path)).toEqual(['api/openapi.yaml', 'docs/asyncapi.yml']);
  });
});

describe('github helpers', () => {
  it('parses repo references', () => {
    expect(parseRepo('https://github.com/acme/orders.git')).toEqual({ owner: 'acme', repo: 'orders' });
    expect(parseRepo('acme/orders')).toEqual({ owner: 'acme', repo: 'orders' });
    expect(parseRepo('nope')).toBeNull();
  });
  it('validates branch names', () => {
    expect(isValidBranchName('feature/add-orders')).toBe(true);
    expect(isValidBranchName('feature//x')).toBe(false);
    expect(isValidBranchName('a..b')).toBe(false);
    expect(isValidBranchName('has space')).toBe(false);
  });
  it('base64 round-trips unicode', () => {
    expect(decodeBase64Utf8(encodeBase64Utf8('héllo — ✓'))).toBe('héllo — ✓');
  });
});
