import { useState } from 'react';
import { isValidBranchName, type RepoRef } from '../lib/github';
import { useSession } from '../lib/session';
import { slugify } from '../lib/contracts';
import { ErrorBox, Field, Modal } from './ui';

export const BRANCH_PREFIX = 'feature/';

/**
 * Asks the user for a feature branch to work on: either an existing one or a
 * new branch created from the default branch. Edits never go to the default branch directly.
 */
export function BranchDialog(props: {
  repo: RepoRef;
  defaultBranch: string;
  branches: string[];
  suggestion?: string;
  onClose: () => void;
  onSelected: (branch: string) => void;
}) {
  const { gh, user } = useSession();
  const existing = props.branches.filter((b) => b !== props.defaultBranch);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState(`${BRANCH_PREFIX}${slugify(props.suggestion || `${user.login}-contract-update`)}`);
  const [pick, setPick] = useState(existing.find((b) => b.startsWith(BRANCH_PREFIX)) ?? existing[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setError(null);
    if (mode === 'existing') return props.onSelected(pick);
    const branch = name.trim();
    if (!isValidBranchName(branch)) return setError(new Error('That is not a valid branch name. Use letters, numbers, "-", "_" and "/".'));
    if (props.branches.includes(branch)) return setError(new Error('A branch with that name already exists. Pick it under "Use existing branch".'));
    setBusy(true);
    try {
      await gh.createBranch(props.repo, branch, props.defaultBranch);
      props.onSelected(branch);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Choose a feature branch"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy || (mode === 'existing' && !pick)}>
            {busy ? 'Creating…' : mode === 'new' ? 'Create branch & continue' : 'Continue'}
          </button>
        </>
      }
    >
      <p className="muted">
        Changes are saved on a separate branch so <code>{props.defaultBranch}</code> stays untouched until a pull request is reviewed and merged.
      </p>
      <div className="segmented">
        <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>New branch</button>
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')} disabled={!existing.length}>
          Use existing branch
        </button>
      </div>
      {mode === 'new' ? (
        <Field label="Branch name" hint={`Created from ${props.defaultBranch}.`}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && confirm()} />
        </Field>
      ) : (
        <Field label="Branch">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {existing.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
      )}
      {error != null && <ErrorBox error={error} />}
    </Modal>
  );
}
