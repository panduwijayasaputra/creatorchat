import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CreatorCustomerDetailResponse } from '@creatorchat/contracts';
import { ChatIcon, CheckCircleIcon, ChevronLeftIcon, ClockIcon } from '@creatorchat/ui';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorScreen } from '../auth/screens/AuthGate';
import { formatDateTime, formatTime, zoneLabel } from '../format/date-time';
import { CREATOR_CHAT_COPY as COPY } from './creator-chat-copy';
import { InitialsAvatar } from './InitialsAvatar';
import chat from '../chat/chat.module.css';
import styles from './creator-chat.module.css';

const DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; data: CreatorCustomerDetailResponse };

/**
 * `CrCustomer` (US-029), access part only: name, Telegram username, the access period and a way
 * back to the chat. The AI card and its footnote belong to Phase F. No Telegram numeric id.
 */
export function CreatorCustomerPage({ api }: { api: MiniappApi }) {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    api.getCreatorCustomer(conversationId).then(
      (data) => current && setState({ status: 'ready', data }),
      (error: unknown) => {
        if (!current) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not-found' }
            : { status: 'error' },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [api, conversationId, attempt]);

  if (state.status === 'error') return <ErrorScreen kind="network" onRetry={reload} />;

  const back = () => void navigate(`/inbox/${conversationId}`);
  return (
    <div className={chat.page}>
      <header className={chat.header}>
        <button type="button" className={chat.iconButton} aria-label={COPY.back} onClick={back}>
          <ChevronLeftIcon size={24} />
        </button>
        <h1 className={styles.title}>{COPY.customer.title}</h1>
      </header>
      {state.status === 'ready' ? (
        <Detail data={state.data} conversationId={conversationId} timeZone={timeZone} />
      ) : state.status === 'not-found' ? (
        <div className={chat.center}>{COPY.gap.notFound}</div>
      ) : (
        <div className={chat.center} role="status">
          {COPY.loadingHistory}
        </div>
      )}
    </div>
  );
}

function Detail({
  data,
  conversationId,
  timeZone,
}: {
  data: CreatorCustomerDetailResponse;
  conversationId: string;
  timeZone: string;
}) {
  const { customer, access } = data;
  const active = access.state === 'ACTIVE' && access.ends_at;
  return (
    <div className={styles.detail}>
      <div className={styles.identity}>
        <InitialsAvatar
          name={customer.display_name}
          url={customer.avatar_url}
          seed={conversationId}
          size={64}
        />
        <div>
          <div className={styles.fullName}>{customer.display_name}</div>
          <div className={styles.from}>{COPY.customer.from(customer.username)}</div>
        </div>
      </div>
      <div className={styles.accessCard}>
        {active ? (
          <>
            <CheckCircleIcon size={24} strokeWidth={2} color="var(--ok-fg)" />
            <div>
              <div className={styles.accessTitle}>
                {COPY.customer.activeUntil(formatDateTime(access.ends_at!, timeZone, DATE))}
              </div>
              <div className={styles.accessSub}>
                {COPY.customer.endsAt(
                  `${formatTime(access.ends_at!, timeZone)} ${zoneLabel(timeZone)}`,
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <ClockIcon size={24} strokeWidth={2} color="var(--exp-fg)" />
            <div>
              <div className={styles.accessTitle}>{COPY.gap.endedTitle}</div>
              <div className={styles.accessSub}>
                {access.ended_at
                  ? COPY.gap.endedAt(formatDateTime(access.ended_at, timeZone, DATE))
                  : COPY.gap.endedNoDate}
              </div>
            </div>
          </>
        )}
      </div>
      <Link to={`/inbox/${conversationId}`} className={styles.open}>
        <ChatIcon size={20} strokeWidth={2} />
        {COPY.customer.openChat}
      </Link>
    </div>
  );
}
