import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GitHub, parseRepo, type RepoRef } from './github';
import { StateStore, type AppState, canEdit as canEditFn, isAdmin as isAdminFn } from './state';

const TOKEN_KEY = 'contract-hub.token';
const STATE_REPO_KEY = 'contract-hub.stateRepo';

export const defaultStateRepo = (import.meta.env.VITE_STATE_REPO as string | undefined) ?? '';

export interface User {
  login: string;
  name: string;
  avatarUrl: string;
}

type StateStatus =
  | { status: 'loading' }
  | { status: 'missing'; canInitialize: boolean }
  | { status: 'error'; error: string }
  | { status: 'ready'; state: AppState };

interface SessionValue {
  gh: GitHub;
  user: User;
  store: StateStore;
  stateRepo: RepoRef;
  appState: StateStatus;
  /** Only valid when appState is ready. */
  state: AppState;
  isAdmin: boolean;
  canEdit: (r: RepoRef) => boolean;
  reload: () => Promise<void>;
  initialize: () => Promise<void>;
  updateState: (message: string, mutate: (s: AppState) => AppState) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

export function readStoredCredentials() {
  const safe = (k: string) => {
    try {
      return localStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  };
  return { token: safe(TOKEN_KEY), stateRepo: safe(STATE_REPO_KEY) || defaultStateRepo };
}

export function storeCredentials(token: string, stateRepo: string) {
  localStorage.setItem(TOKEN_KEY, token);
  storeStateRepo(stateRepo);
}

export function storeStateRepo(stateRepo: string) {
  try {
    localStorage.setItem(STATE_REPO_KEY, stateRepo);
  } catch {
    /* ignore */
  }
}

export function clearCredentials() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Validates a token + state repo pair, used by the sign-in screen. */
export async function signIn(token: string, stateRepo: string): Promise<{ gh: GitHub; user: User; repo: RepoRef }> {
  const repo = parseRepo(stateRepo);
  if (!repo) throw new Error('State repository must look like "owner/name".');
  const gh = new GitHub(token);
  const user = await gh.currentUser();
  try {
    await gh.getRepo(repo);
  } catch {
    throw new Error(`Cannot access ${stateRepo}. Check the name and that your GitHub account can read it.`);
  }
  return { gh, user, repo };
}

const EMPTY: AppState = { schemaVersion: 1, admins: [], projects: [] };

export function SessionProvider(props: { gh: GitHub; user: User; stateRepo: RepoRef; onSignOut: () => void; children: ReactNode }) {
  const { gh, user, stateRepo, onSignOut } = props;
  const store = useMemo(() => new StateStore(gh, stateRepo), [gh, stateRepo]);
  const [appState, setAppState] = useState<StateStatus>({ status: 'loading' });

  const reload = useCallback(async () => {
    try {
      const loaded = await store.load();
      if (loaded) {
        setAppState({ status: 'ready', state: loaded.state });
      } else {
        const repo = await gh.getRepo(stateRepo);
        setAppState({ status: 'missing', canInitialize: repo.canPush });
      }
    } catch (e) {
      setAppState({ status: 'error', error: (e as Error).message });
    }
  }, [gh, store, stateRepo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SessionValue>(() => {
    const state = appState.status === 'ready' ? appState.state : EMPTY;
    return {
      gh,
      user,
      store,
      stateRepo,
      appState,
      state,
      isAdmin: isAdminFn(state, user.login),
      canEdit: (r) => canEditFn(state, user.login, r),
      reload,
      initialize: async () => {
        const loaded = await store.initialize(user.login);
        setAppState({ status: 'ready', state: loaded.state });
      },
      updateState: async (message, mutate) => {
        const loaded = await store.update(message, mutate);
        setAppState({ status: 'ready', state: loaded.state });
      },
      signOut: onSignOut,
    };
  }, [gh, user, store, stateRepo, appState, reload, onSignOut]);

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}
