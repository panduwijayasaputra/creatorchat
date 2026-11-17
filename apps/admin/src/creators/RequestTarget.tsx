import type { AdminCreatorRequest } from '@creatorchat/contracts';
import { StatusChip } from '@creatorchat/ui';
import { initialsOf } from './format';
import styles from './review-dialog.module.css';

/** The disc colours the boards use for different people (background, letters). */
export const PALETTE = [
  { bg: '#E6D5E4', fg: '#6B5578' },
  { bg: '#E6C3B5', fg: '#8E5B48' },
  { bg: '#F5DCE5', fg: '#A83F67' },
] as const;

export function paletteFor(id: string) {
  let sum = 0;
  for (const char of id) sum += char.charCodeAt(0);
  return PALETTE[sum % PALETTE.length] ?? PALETTE[0];
}

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;

/** The identity box of the review dialogs: who the decision applies to. Text only. */
export function RequestTarget({ request }: { request: AdminCreatorRequest }) {
  const colour = paletteFor(request.user.id);
  const handle = request.user.telegram_username ? `@${request.user.telegram_username}` : null;
  const parts = [handle, `ID ${request.user.telegram_id}`, TYPE_LABEL[request.creator_type]].filter(
    Boolean,
  );
  return (
    <>
      <span
        className={styles.avatar}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {initialsOf(request.creator_name)}
      </span>
      <div className={styles.identity}>
        <div className={styles.name}>{request.creator_name}</div>
        <div className={styles.meta}>{parts.join(' · ')}</div>
      </div>
      <span className={styles.chip}>
        <StatusChip status="request" />
      </span>
    </>
  );
}
