import type { ChangeEvent } from 'react';
import { ChevronDownIcon } from '../../icons';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Accessible name; also the visible prefix ("Status:") unless `hideLabel`. */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hideLabel?: boolean;
  compact?: boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * Dropdown trigger from AdmTableStates ("Status: **Semua** ⌄"). A real native `<select>` sits
 * invisibly over the styled trigger, so keyboard, screen readers and mobile pickers keep working.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
  compact = false,
  disabled,
  id,
}: SelectProps) {
  const selected = options.find((o) => o.value === value);
  return (
    <span className={[styles.wrap, compact ? styles.compact : ''].filter(Boolean).join(' ')}>
      <span className={styles.face} aria-hidden="true">
        <span className={styles.text}>
          {hideLabel ? null : <span className={styles.prefix}>{label}: </span>}
          <strong className={styles.value}>{selected?.label ?? ''}</strong>
        </span>
        <ChevronDownIcon size={16} strokeWidth={2} />
      </span>
      <select
        id={id}
        className={styles.native}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
