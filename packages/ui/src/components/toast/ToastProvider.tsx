import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircleIcon, CheckCircleIcon } from '../../icons';
import styles from './Toast.module.css';

export type ToastKind = 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  message: string;
  /** Milliseconds before auto-dismiss (default 5000). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'kind' | 'message'>> {
  id: number;
  duration: number;
}

interface ToastApi {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    const item: ToastItem = {
      id,
      kind: options.kind ?? 'success',
      message: options.message,
      duration: options.duration ?? 5000,
    };
    setItems((current) => [...current, item].slice(-MAX_VISIBLE));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region}>
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [paused, item.id, item.duration, onDismiss]);

  const Icon = item.kind === 'error' ? AlertCircleIcon : CheckCircleIcon;
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={styles.toast}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={20} strokeWidth={2} />
      <span className={styles.message}>{item.message}</span>
    </div>
  );
}
