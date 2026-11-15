import type { InputHTMLAttributes } from 'react';
import { SearchIcon } from '../../icons';
import styles from './Field.module.css';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Required: the visible placeholder is not a label. */
  'aria-label': string;
  /** Mini App size: 48 px, 16 px radius, 16 px text (Main board). */
  large?: boolean;
}

/** Table/list search box (AdmTableStates, Main). Width is set by the caller. */
export function SearchInput({ className, large = false, ...rest }: SearchInputProps) {
  return (
    <div
      className={[styles.control, styles.search, large ? styles.searchLarge : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <SearchIcon size={18} strokeWidth={2} />
      <input {...rest} type="search" className={styles.bare} />
    </div>
  );
}
