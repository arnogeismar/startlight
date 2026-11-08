import { GitHub, isConflict, repoKey, type RepoRef } from './github';
import type { ContractKind } from './contracts';

export const STATE_FILE = 'contract-hub.json';

export interface ContractSummary {
  path: string;
  kind: ContractKind;
  specVersion: string;
  title: string;
  version: string;
}

export interface Project extends RepoRef {
  addedBy: string;
  addedAt: string;
  /** GitHub logins allowed to edit contracts in this repo (admins can always edit). */
  editors: string[];
  lastScan?: {
    at: string;
    branch: string;
    treeSha: string;
    contracts: ContractSummary[];
  };
}

export interface AppState {
  schemaVersion: 1;
  /** GitHub logins with admin rights in the app. */
  admins: string[];
  projects: Project[];
}

export interface LoadedState {
  state: AppState;
  sha: string | null;
}

export const emptyState = (admin: string): AppState => ({ schemaVersion: 1, admins: [admin], projects: [] });

const norm = (s: string) => s.toLowerCase();

export function isAdmin(state: AppState, login: string): boolean {
  return state.admins.some((a) => norm(a) === norm(login));
}

export function findProject(state: AppState, r: RepoRef): Project | undefined {
  return state.projects.find((p) => repoKey(p) === repoKey(r));
}

/** Everyone can read. Admins can edit everything; editors only the repos they're listed on. */
export function canEdit(state: AppState, login: string, r: RepoRef): boolean {
  if (isAdmin(state, login)) return true;
  const p = findProject(state, r);
  return Boolean(p?.editors.some((e) => norm(e) === norm(login)));
}

export function validateState(raw: unknown): AppState {
  const s = raw as Partial<AppState>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.admins) || !Array.isArray(s.projects)) {
    throw new Error(`${STATE_FILE} is malformed: expected { admins: [], projects: [] }`);
  }
  return {
    schemaVersion: 1,
    admins: s.admins.filter((a): a is string => typeof a === 'string'),
    projects: s.projects.map((p) => ({ ...p, editors: Array.isArray(p.editors) ? p.editors : [] })),
  };
}

/**
 * Reads and writes the app state file in the state repository.
 * Writes use the file's blob sha for optimistic locking: on a conflict the
 * latest version is re-read and the mutation is re-applied.
 */
export class StateStore {
  constructor(
    private gh: GitHub,
    readonly repo: RepoRef,
  ) {}

  async load(): Promise<LoadedState | null> {
    const file = await this.gh.readFile(this.repo, STATE_FILE);
    if (!file) return null;
    return { state: validateState(JSON.parse(file.text)), sha: file.sha };
  }

  async initialize(admin: string): Promise<LoadedState> {
    const state = emptyState(admin);
    const { sha } = await this.gh.writeFile(this.repo, STATE_FILE, serialize(state), `Initialize Contract Hub (admin: ${admin})`);
    return { state, sha };
  }

  async update(message: string, mutate: (s: AppState) => AppState, attempts = 3): Promise<LoadedState> {
    for (let i = 0; ; i++) {
      const current = await this.load();
      if (!current) throw new Error('State file is missing; initialize the state repository first.');
      const next = mutate(structuredClone(current.state));
      try {
        const { sha } = await this.gh.writeFile(this.repo, STATE_FILE, serialize(next), message, { sha: current.sha ?? undefined });
        return { state: next, sha };
      } catch (e) {
        if (!isConflict(e) || i >= attempts - 1) throw e;
      }
    }
  }
}

export const serialize = (s: AppState) => JSON.stringify(s, null, 2) + '\n';
