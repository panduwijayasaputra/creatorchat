import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { creatorPath, utcOffsetLabel, type SubscriptionItem } from '@creatorchat/contracts';
import { AlertCircleIcon, BookmarkIcon, RefreshIcon, StatusChip } from '@creatorchat/ui';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { formatDateTime, formatTime, zoneLabel } from '../format/date-time';
import { SUBSCRIPTIONS_COPY as C } from './subscriptions-copy';
import styles from './subscriptions.module.css';
import { useSubscriptions } from './useSubscriptions';

/** The disc colours the boards use for different people (background, letters). */
const PALETTE = [
  { bg: '#E6C3B5', fg: '#8E5B48' },
  { bg: '#F0D3B8', fg: '#8E6B48' },
  { bg: '#D9C3D6', fg: '#6B5578' },
] as const;

function paletteFor(code: string) {
  let sum = 0;
  for (const char of code) sum += char.charCodeAt(0);
  return PALETTE[sum % PALETTE.length] ?? PALETTE[0];
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase() || '?';

const dateTimeOf = (iso: string, zone: string) =>
  `${formatDateTime(iso, zone, { day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(iso, zone)} ${zoneLabel(zone)}`;

function Card({
  item,
  zone,
  sending,
  failed,
  onExtend,
  onOpenChat,
}: {
  item: SubscriptionItem;
  zone: string;
  sending: boolean;
  failed: boolean;
  onExtend: () => void;
  onOpenChat: () => void;
}) {
  const { access } = item;
  const colour = paletteFor(item.public_code);
  const when =
    access.state === 'ACTIVE'
      ? `${C.activeUntil} ${dateTimeOf(access.ends_at, zone)}`
      : access.state === 'PENDING'
        ? `${C.requested} ${dateTimeOf(access.requested_at, zone)} · ${C.waiting}`
        : `${C.endedAt} ${dateTimeOf(access.ended_at, zone)}`;
  const chip =
    access.state === 'ACTIVE' ? (
      <StatusChip status="active" label={C.chips.ACTIVE} />
    ) : access.state === 'PENDING' ? (
      <StatusChip status="pending" label={C.chips.PENDING} />
    ) : (
      <StatusChip status="expired" label={C.chips.EXPIRED} />
    );
  const profile = (
    <Link to={creatorPath(item.public_code)} className={styles.outline}>
      {C.profile}
    </Link>
  );

  return (
    <li className={styles.card}>
      <div className={styles.head}>
        <div
          className={styles.disc}
          style={{ background: colour.bg, color: colour.fg }}
          aria-hidden="true"
        >
          {item.avatar_url ? (
            <img src={item.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            initialsOf(item.display_name)
          )}
        </div>
        <div className={styles.who}>
          <div className={styles.name}>{item.display_name}</div>
          <div className={styles.chip}>{chip}</div>
        </div>
      </div>
      <div className={styles.when}>{when}</div>
      {!item.creator_available ? (
        <div className={styles.note}>{C.gap.unavailable}</div>
      ) : (
        <div className={styles.actions}>
          {access.state === 'ACTIVE' ? (
            <>
              <div className={styles.grow}>
                {item.conversation_id ? (
                  <Link to={`/chats/${item.conversation_id}`} className={styles.primary}>
                    {C.openChat}
                  </Link>
                ) : (
                  <button type="button" className={styles.primary} onClick={onOpenChat}>
                    {C.openChat}
                  </button>
                )}
              </div>
              {profile}
            </>
          ) : access.state === 'PENDING' ? (
            <div className={styles.grow}>{profile}</div>
          ) : (
            <div className={styles.grow}>
              <button
                type="button"
                className={styles.primary}
                disabled={sending}
                aria-disabled={sending}
                onClick={onExtend}
              >
                {sending ? C.gap.sending : C.extend}
              </button>
              {failed ? (
                <div className={styles.error} role="alert">
                  {C.gap.requestFailed}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * `Subscriptions` (`/subscriptions`): the customer's own creators, ordered by the server. "Minta
 * Perpanjangan Akses" reuses the US-023 request and refetches, so the card turns Menunggu; "Buka
 * Chat" is a placeholder until the chat stories.
 */
export function SubscriptionsPage({
  api,
}: {
  api: Pick<MiniappApi, 'listSubscriptions' | 'requestAccess'>;
}) {
  const { state, retry, refetch } = useSubscriptions(api);
  const auth = useAuth();
  const zone = auth.state.status === 'authenticated' ? auth.state.user.timezone : 'Asia/Jakarta';
  const [flash, showFlash] = useFlashMessage();
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(false);

  /** One request at a time; the server is idempotent, so a lost response can simply be retried. */
  const extend = async (code: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(code);
    setFailed(null);
    try {
      try {
        await api.requestAccess(code);
      } catch (error) {
        // Already active, or the creator is gone: the refetch below shows the truth.
        const settled =
          error instanceof ApiError &&
          (error.code === 'ACCESS_ALREADY_ACTIVE' || error.code === 'CREATOR_NOT_FOUND');
        if (!settled) throw error;
      }
      if (!(await refetch())) setFailed(code);
    } catch {
      setFailed(code);
    } finally {
      inFlight.current = false;
      setSending(null);
    }
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{C.title}</h1>
      {state.status === 'loading' ? (
        <div role="status" aria-label={C.gap.loading} style={{ marginTop: 12 }}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonRow} aria-hidden="true">
              <div className={styles.skeletonDisc} />
              <div className={styles.skeletonBars}>
                <div className={styles.skeletonBarA} />
                <div className={styles.skeletonBarB} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.panel} role="alert">
          <span className={`${styles.panelDisc} ${styles.panelDiscError}`}>
            <AlertCircleIcon size={36} strokeWidth={2} />
          </span>
          <div className={styles.panelTitle}>{C.gap.errorTitle}</div>
          <div className={styles.panelText}>{C.gap.errorText}</div>
          <div className={styles.panelAction}>
            <button type="button" className={styles.primary} onClick={retry}>
              <RefreshIcon size={20} strokeWidth={2} />
              {C.gap.retry}
            </button>
          </div>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <div className={styles.panel}>
          <span className={styles.panelDisc}>
            <BookmarkIcon size={36} strokeWidth={2} />
          </span>
          <div className={styles.panelTitle}>{C.gap.emptyTitle}</div>
          <div className={styles.panelText}>{C.gap.emptyText}</div>
          <div className={styles.panelAction}>
            <Link to="/explore" className={styles.primary}>
              {C.gap.emptyAction}
            </Link>
          </div>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <>
          <ul className={styles.list}>
            {state.items.map((item) => (
              <Card
                key={item.public_code}
                item={item}
                zone={zone}
                sending={sending === item.public_code}
                failed={failed === item.public_code}
                onExtend={() => void extend(item.public_code)}
                onOpenChat={() => showFlash(C.gap.notYet)}
              />
            ))}
          </ul>
          <p className={styles.footer}>
            {C.footer} {zoneLabel(zone)} ({utcOffsetLabel(zone, new Date())}).
          </p>
        </>
      ) : null}
      <BottomToast message={flash} kind="info" />
    </main>
  );
}
