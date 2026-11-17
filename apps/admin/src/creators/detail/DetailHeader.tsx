import type { CreatorDetail } from '@creatorchat/contracts';
import { instagramHandle } from '@creatorchat/contracts';
import {
  Button,
  CalendarIcon,
  CheckIcon,
  GlobeIcon,
  RefreshIcon,
  SendIcon,
  StatusChip,
  UserIcon,
  UserSlashIcon,
  XIcon,
} from '@creatorchat/ui';
import { DETAIL_COPY } from '../copy';
import { formatDateTimeWib, formatDateWib, initialsOf } from '../format';
import { paletteFor } from '../RequestTarget';
import styles from './creator-detail.module.css';

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;

export interface HeaderHandlers {
  onApprove: () => void;
  onReject: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}

function dateLine(detail: CreatorDetail): string {
  const labels = DETAIL_COPY.dateLabels;
  if (detail.status === 'REQUEST') return `${labels.request} ${formatDateTimeWib(detail.since)}`;
  if (detail.status === 'BLOCKED') {
    return detail.blocked_at
      ? `${labels.blocked} ${formatDateTimeWib(detail.blocked_at)}`
      : labels.blocked;
  }
  return `${labels.active} ${formatDateWib(detail.since)}`;
}

/** The header card of `AdmCrReq` / `AdmCrActive` / `AdmCrBlocked`. Everything is rendered as text. */
export function DetailHeader({
  detail,
  handlers,
}: {
  detail: CreatorDetail;
  handlers: HeaderHandlers;
}) {
  const colour = paletteFor(detail.id);
  const chip = detail.status.toLowerCase() as 'request' | 'active' | 'blocked';
  const handle = detail.telegram_username ? `@${detail.telegram_username} · ` : '';
  return (
    <section className={styles.header} aria-label="Identitas">
      {detail.avatar_url ? (
        <img
          className={styles.disc}
          src={detail.avatar_url}
          alt=""
          referrerPolicy="no-referrer"
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span
          className={styles.disc}
          style={{ background: colour.bg, color: colour.fg }}
          aria-hidden="true"
        >
          {initialsOf(detail.creator_name)}
        </span>
      )}
      <div className={styles.who}>
        <div className={styles.nameRow}>
          <h2 className={styles.name}>{detail.creator_name}</h2>
          <StatusChip status={chip} />
        </div>
        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <SendIcon size={16} strokeWidth={2} />
            {handle}ID {detail.telegram_id}
          </span>
          {detail.instagram_url ? (
            <span className={styles.metaItem}>
              <GlobeIcon size={16} strokeWidth={2} />
              {instagramHandle(detail.instagram_url)}
            </span>
          ) : null}
          <span className={styles.metaItem}>
            <UserIcon size={16} strokeWidth={2} />
            {TYPE_LABEL[detail.creator_type]}
          </span>
          <span className={styles.metaItem}>
            <CalendarIcon size={16} strokeWidth={2} />
            {dateLine(detail)}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        {detail.status === 'REQUEST' ? (
          <>
            <Button icon={<CheckIcon size={16} strokeWidth={2} />} onClick={handlers.onApprove}>
              Setujui
            </Button>
            <Button
              variant="danger"
              icon={<XIcon size={16} strokeWidth={2} />}
              onClick={handlers.onReject}
            >
              Tolak
            </Button>
          </>
        ) : null}
        {detail.status === 'ACTIVE' ? (
          <Button
            variant="danger"
            icon={<UserSlashIcon size={16} strokeWidth={2} />}
            onClick={handlers.onBlock}
          >
            Block
          </Button>
        ) : null}
        {detail.status === 'BLOCKED' ? (
          <Button
            variant="outline"
            icon={<RefreshIcon size={16} strokeWidth={2} />}
            onClick={handlers.onUnblock}
          >
            Unblock
          </Button>
        ) : null}
      </div>
    </section>
  );
}
