import type { CreatorListRow } from '@creatorchat/contracts';
import { StatusChip } from '@creatorchat/ui';
import { initialsOf } from './format';
import { paletteFor } from './RequestTarget';
import styles from './review-dialog.module.css';

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;

/** The identity box of the block / unblock dialogs (`AdmDlgBlock`, `AdmDlgUnblock`). Text only. */
export function CreatorTarget({
  row,
  status,
}: {
  row: CreatorListRow;
  status: 'active' | 'blocked';
}) {
  const colour = paletteFor(row.id);
  const handle = row.telegram_username ? `@${row.telegram_username}` : null;
  const parts = [handle, `ID ${row.telegram_id}`, TYPE_LABEL[row.creator_type]].filter(Boolean);
  return (
    <>
      <span
        className={styles.avatar}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {initialsOf(row.creator_name)}
      </span>
      <div className={styles.identity}>
        <div className={styles.name}>{row.creator_name}</div>
        <div className={styles.meta}>{parts.join(' · ')}</div>
      </div>
      <span className={styles.chip}>
        <StatusChip status={status} />
      </span>
    </>
  );
}
