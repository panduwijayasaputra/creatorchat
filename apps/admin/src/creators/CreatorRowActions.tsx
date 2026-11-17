import type { CreatorListRow } from '@creatorchat/contracts';
import { Button, EyeIcon, RefreshIcon, UserSlashIcon } from '@creatorchat/ui';
import styles from './creators-page.module.css';

export interface RowActionHandlers {
  onView: (row: CreatorListRow) => void;
  onApprove: (row: CreatorListRow) => void;
  onReject: (row: CreatorListRow) => void;
  onBlock: (row: CreatorListRow) => void;
  onUnblock: (row: CreatorListRow) => void;
}

/** The Aksi cell. */
export function CreatorRowActions({
  row,
  handlers,
}: {
  row: CreatorListRow;
  handlers: RowActionHandlers;
}) {
  return (
    <div className={styles.actions}>
      <Button
        size="table"
        variant="outline"
        className={styles.compact}
        icon={<EyeIcon size={16} strokeWidth={2} />}
        aria-label={`View ${row.creator_name}`}
        onClick={() => handlers.onView(row)}
      >
        View
      </Button>
      {row.status === 'REQUEST' ? (
        <>
          <Button
            size="table"
            className={styles.compact}
            aria-label={`Setujui ${row.creator_name}`}
            onClick={() => handlers.onApprove(row)}
          >
            Setujui
          </Button>
          <Button
            size="table"
            variant="danger"
            className={styles.compact}
            aria-label={`Tolak ${row.creator_name}`}
            onClick={() => handlers.onReject(row)}
          >
            Tolak
          </Button>
        </>
      ) : null}
      {row.status === 'ACTIVE' ? (
        <Button
          size="table"
          variant="danger"
          className={styles.compact}
          icon={<UserSlashIcon size={15} strokeWidth={2} />}
          aria-label={`Block ${row.creator_name}`}
          onClick={() => handlers.onBlock(row)}
        >
          Block
        </Button>
      ) : null}
      {row.status === 'BLOCKED' ? (
        <Button
          size="table"
          variant="outline"
          className={styles.compact}
          icon={<RefreshIcon size={15} strokeWidth={2} />}
          aria-label={`Unblock ${row.creator_name}`}
          onClick={() => handlers.onUnblock(row)}
        >
          Unblock
        </Button>
      ) : null}
    </div>
  );
}
