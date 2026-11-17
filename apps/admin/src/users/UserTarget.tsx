import type { UserListRow } from '@creatorchat/contracts';
import { StatusChip } from '@creatorchat/ui';
import { initialsOf } from '../creators/format';
import { paletteFor } from '../creators/RequestTarget';
import styles from '../creators/review-dialog.module.css';

/** The identity box of the user block / unblock dialogs (`AdmDlgUserBlock`). Text only. */
export function UserTarget({ row, status }: { row: UserListRow; status: 'active' | 'blocked' }) {
  const colour = paletteFor(row.id);
  const handle = row.telegram_username ? `@${row.telegram_username}` : null;
  const meta = [handle, `ID ${row.telegram_id}`].filter(Boolean).join(' · ');
  return (
    <>
      <span
        className={styles.avatar}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {initialsOf(row.display_name)}
      </span>
      <div className={styles.identity}>
        <div className={styles.name}>{row.display_name}</div>
        <div className={styles.meta}>{meta}</div>
      </div>
      <span className={styles.chip}>
        <StatusChip status={status} />
      </span>
    </>
  );
}
