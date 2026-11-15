import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../button/Button';
import styles from './ConfirmDialog.module.css';

export interface ConfirmReason {
  /** Field label, e.g. "Alasan block (wajib)". */
  label: string;
  required?: boolean;
  hint?: ReactNode;
  placeholder?: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Round icon at the top left (tone follows `destructive`). */
  icon?: ReactNode;
  /** Identity box showing exactly what the action applies to. */
  target?: ReactNode;
  /** The specific consequence, in plain words. */
  consequence: ReactNode;
  reason?: ConfirmReason;
  cancelLabel?: string;
  /** Specific verb ("Block Creator", "Logout"), never a generic "OK". */
  confirmLabel: string;
  destructive?: boolean;
  /** Dialog width in px (560 by default; the logout dialog is 480). */
  width?: number;
  /** Shown inline when `onConfirm` throws; the thrown message is never displayed. */
  failureMessage?: string;
  onConfirm: (reason?: string) => Promise<void> | void;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation dialog for mutations (AdmDlg*, AdmLogoutDlg): title, target box, consequence,
 * optional required reason, "Batal" and a specific verb. While `onConfirm` is pending the confirm
 * button is busy and every way of closing is disabled; a synchronous double click fires once.
 */
export function ConfirmDialog({
  open,
  title,
  icon,
  target,
  consequence,
  reason,
  cancelLabel = 'Batal',
  confirmLabel,
  destructive = false,
  width = 560,
  failureMessage = 'Gagal memproses. Coba lagi.',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<Element | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);

  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reasonText, setReasonText] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Open: remember the opener, lock scroll, move focus in. Close: restore.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setFailed(false);
    setReasonText('');
    (reasonRef.current ?? cancelRef.current)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open]);

  const close = useCallback(() => {
    if (pendingRef.current) return;
    onClose();
  }, [onClose]);

  const trimmed = reasonText.trim();
  const reasonMissing = Boolean(reason?.required) && trimmed === '';

  const confirm = async () => {
    if (pendingRef.current || reasonMissing) return;
    pendingRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm(reason ? trimmed : undefined);
      pendingRef.current = false;
      if (mounted.current) {
        setPending(false);
        onClose();
      }
    } catch {
      pendingRef.current = false;
      if (mounted.current) {
        setPending(false);
        setFailed(true);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={styles.dialog}
        style={{ width }}
        onKeyDown={onKeyDown}
      >
        <div className={styles.head}>
          {icon ? (
            <span className={`${styles.icon} ${destructive ? styles.iconDanger : ''}`}>{icon}</span>
          ) : null}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        </div>
        <div className={styles.body}>
          {target ? <div className={styles.target}>{target}</div> : null}
          <div id={descId}>{consequence}</div>
          {reason ? (
            <div>
              <label htmlFor={reasonId} className={styles.reasonLabel}>
                {reason.label}
              </label>
              <textarea
                id={reasonId}
                ref={reasonRef}
                className={styles.reason}
                value={reasonText}
                placeholder={reason.placeholder}
                required={reason.required}
                disabled={pending}
                onChange={(e) => setReasonText(e.target.value)}
              />
              {reason.hint ? <div className={styles.hint}>{reason.hint}</div> : null}
            </div>
          ) : null}
          {failed ? (
            <div role="alert" className={styles.error}>
              {failureMessage}
            </div>
          ) : null}
        </div>
        <div className={styles.actions}>
          <Button ref={cancelRef} variant="outline" onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={pending}
            disabled={reasonMissing}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
