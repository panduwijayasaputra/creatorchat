import type { ReactNode } from 'react';
import styles from './KvList.module.css';

export interface KvItem {
  label: string;
  value: ReactNode;
}

/** Label/value rows (AdmSubDetail): 150 px label column, divider above each row. */
export function KvList({ items }: { items: readonly KvItem[] }) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div key={item.label} className={styles.row}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
