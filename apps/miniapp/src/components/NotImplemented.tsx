import { InfoCircleIcon } from '@creatorchat/ui';
import type { ReactNode } from 'react';
import styles from './NotImplemented.module.css';

/** Neutral placeholder for destinations that are not built yet. Not a fake final screen. */
export function NotImplemented({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className={styles.wrap} data-testid="not-implemented">
      <span className={styles.icon}>
        <InfoCircleIcon size={24} strokeWidth={2} />
      </span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>Halaman ini belum dibangun.</p>
      {children}
    </section>
  );
}
