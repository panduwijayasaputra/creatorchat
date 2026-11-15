import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import styles from './Field.module.css';

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** Inline error text; marks the control invalid and is announced. */
  error?: ReactNode;
  children: ReactElement<ControlProps>;
}

/** Wires label, hint and error to a single control through `id` / `aria-describedby`. */
export function Field({ label, hint, error, children }: FieldProps) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error ? (
        <div id={errorId} role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
