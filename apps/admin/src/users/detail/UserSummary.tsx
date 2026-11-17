import type { UserDetailResponse } from '@creatorchat/contracts';
import { AlertCircleIcon, Button, LockIcon, StatusChip } from '@creatorchat/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import detail from '../../creators/detail/creator-detail.module.css';
import { formatDateTimeWib, formatDateWib } from '../../creators/format';
import { USER_DETAIL_COPY as C } from '../copy';
import styles from './user-detail.module.css';

type UserDetail = Extract<UserDetailResponse, { role: 'USER' }>;
const CHIP = { NONE: 'none', PENDING: 'pending', REJECTED: 'rejected' } as const;

function Row({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <div className={detail.row} style={{ '--label': `${width}px` } as never}>
      <div className={detail.label}>{label}</div>
      <div className={detail.value}>{children}</div>
    </div>
  );
}

/** `AdmUserSummary` / `AdmUserBlocked`. All text is rendered as text. */
export function UserSummary({ data, userId }: { data: UserDetail; userId: string }) {
  const { user, subscriptions, creator_request: request, block } = data;
  const s = C.summary;
  return (
    <>
      {block ? (
        <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
          <span className={styles.bannerIcon}>
            <AlertCircleIcon size={20} strokeWidth={2} />
          </span>
          <div>
            <div className={styles.bannerTitle}>{s.blockedTitle}</div>
            <div className={styles.bannerText}>
              {C.gap.blockedLine(formatDateTimeWib(block.at), block.admin_label, block.reason)}
            </div>
          </div>
        </div>
      ) : null}
      <div className={styles.threeCols}>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>{s.profileTitle}</h3>
          <Row label={s.displayName} width={150}>
            {user.display_name}
          </Row>
          <Row label={s.bio} width={150}>
            {user.bio ?? '–'}
          </Row>
          <Row label={s.username} width={150}>
            {user.telegram_username ? `@${user.telegram_username}` : '–'}
          </Row>
          <Row label={s.role} width={150}>
            USER
          </Row>
        </section>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>{s.subsTitle}</h3>
          <Row label={s.active} width={160}>
            {subscriptions.active_count}
          </Row>
          <Row label={s.expired} width={160}>
            {subscriptions.expired_count}
          </Row>
          {subscriptions.nearest_end ? (
            <Row label={s.nearest} width={160}>
              {subscriptions.nearest_end.creator_name},{' '}
              {formatDateWib(subscriptions.nearest_end.ends_at)}
            </Row>
          ) : null}
          <div className={styles.buttonRow}>
            <Link to={`/users/${encodeURIComponent(userId)}/subscriptions`} tabIndex={-1}>
              <Button variant="outline">{s.manage}</Button>
            </Link>
          </div>
        </section>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>{s.requestTitle}</h3>
          <div className={styles.chipRow}>
            <StatusChip status={CHIP[request.status]} />
          </div>
          {request.submitted_at ? (
            <Row label={s.submitted} width={150}>
              {formatDateTimeWib(request.submitted_at)}
            </Row>
          ) : null}
          {request.rejection_count > 0 ? (
            <Row label={s.rejected} width={150}>
              {request.rejection_count} kali
              {request.last_rejected_at ? ` (${formatDateWib(request.last_rejected_at)})` : ''}
            </Row>
          ) : null}
          {request.latest_request_id ? (
            <div className={styles.buttonRow}>
              <Link
                to={`/users/${encodeURIComponent(userId)}/requests/${encodeURIComponent(request.latest_request_id)}`}
                tabIndex={-1}
              >
                <Button variant="outline">{s.detail}</Button>
              </Link>
            </div>
          ) : null}
        </section>
      </div>
      <div className={`${detail.note} ${styles.footerNote}`}>
        <LockIcon size={16} strokeWidth={2} />
        <span>{s.privacy}</span>
      </div>
    </>
  );
}
