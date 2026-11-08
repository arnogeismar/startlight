import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-row">
      <span className="spinner" aria-hidden /> {label ?? 'Loading…'}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert alert-error" role="alert">
      <span>{msg}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`modal ${props.wide ? 'modal-wide' : ''}`} onClose={props.onClose} onCancel={props.onClose}>
      <header className="modal-header">
        <h2>{props.title}</h2>
        <button className="btn-icon" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="modal-body">{props.children}</div>
      {props.footer && <footer className="modal-footer">{props.footer}</footer>}
    </dialog>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method.toUpperCase()}</span>;
}

export function KindBadge({ kind }: { kind: 'openapi' | 'asyncapi' }) {
  return <span className={`kind kind-${kind}`}>{kind === 'openapi' ? 'OpenAPI' : 'AsyncAPI'}</span>;
}

export function ActionBadge({ action }: { action: string }) {
  return <span className={`action action-${action}`}>{action}</span>;
}

export function Field(props: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${props.className ?? ''}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

/** Text input that only commits on blur/Enter, useful for keys (renaming) where every keystroke would re-key the object. */
export function CommitInput(props: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  validate?: (v: string) => string | null;
}) {
  const [v, setV] = useState(props.value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    if (v === props.value) return;
    const e = props.validate?.(v) ?? null;
    setErr(e);
    if (e) return;
    props.onCommit(v);
  };
  return (
    <span className="commit-input">
      <input
        className={`${props.className ?? ''} ${err ? 'invalid' : ''}`}
        value={v}
        placeholder={props.placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setV(props.value);
            setErr(null);
          }
        }}
      />
      {err && <span className="field-error">{err}</span>}
    </span>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; error: unknown; data: T | undefined }>({
    loading: true,
    error: null,
    data: undefined,
  });
  const latest = useRef(0);
  const run = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === latest.current) setState({ loading: false, error: null, data });
    } catch (error) {
      if (id === latest.current) setState({ loading: false, error, data: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { ...state, reload: run, setData: (data: T) => setState({ loading: false, error: null, data }) };
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}
