import type { ReactNode } from 'react';
import styles from '../../../creators/review-dialog.module.css';
import { initialsOf } from '../../../creators/format';
import { paletteFor } from '../../../creators/RequestTarget';

export interface AccessUser {
  id: string;
  display_name: string;
  telegram_username: string | null;
  telegram_id: string;
}

/** The identity box of the access dialogs (`AdmDlgGrant|Extend|Revoke`). Text only. */
export function AccessTarget({
  user,
  title,
  subtitle,
  chip,
}: {
  user: AccessUser;
  /** Defaults to the user's name. */
  title?: string;
  /** Defaults to `@username · ID …`. */
  subtitle?: string;
  chip?: ReactNode;
}) {
  const colour = paletteFor(user.id);
  const meta = [
    user.telegram_username ? `@${user.telegram_username}` : null,
    `ID ${user.telegram_id}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <span
        className={styles.avatar}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {initialsOf(user.display_name)}
      </span>
      <div className={styles.identity}>
        <div className={styles.name}>{title ?? user.display_name}</div>
        <div className={styles.meta}>{subtitle ?? meta}</div>
      </div>
      {chip ? <span className={styles.chip}>{chip}</span> : null}
    </>
  );
}
