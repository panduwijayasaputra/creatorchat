import { Card, InfoCircleIcon } from '@creatorchat/ui';
import type { ReactNode } from 'react';
import styles from './NotImplemented.module.css';

/** Neutral placeholder for destinations that are not built yet. Not a fake final screen. */
export function NotImplemented({ children }: { children?: ReactNode }) {
  return (
    <Card large className={styles.card} data-testid="not-implemented">
      <span className={styles.icon}>
        <InfoCircleIcon size={24} strokeWidth={2} />
      </span>
      <h2 className={styles.title}>Halaman ini belum dibangun</h2>
      <p className={styles.text}>Bagian ini belum tersedia dan akan hadir pada tahap berikutnya.</p>
      {children}
    </Card>
  );
}
