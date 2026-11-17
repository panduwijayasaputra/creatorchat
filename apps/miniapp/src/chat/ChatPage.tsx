import { useCallback, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { Avatar, ChevronLeftIcon, ClockIcon, DotsIcon } from '@creatorchat/ui';
import { ApiError, type MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorScreen } from '../auth/screens/AuthGate';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { formatDateTime, formatTime, zoneLabel } from '../format/date-time';
import { CHAT_COPY as COPY } from './chat-copy';
import { Composer, Skeletons, ThreadBody } from './ChatThread';
import { useChat, type ChatConversation } from './useChat';
import styles from './chat.module.css';

const DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;

function Header({
  conversation,
  subtitle,
  onBack,
  onOptions,
}: {
  conversation: ChatConversation | null;
  subtitle: string;
  onBack: () => void;
  onOptions: () => void;
}) {
  const identity = (
    <>
      <Avatar size={40} src={conversation?.creator.avatar_url ?? null} />
      <span style={{ minWidth: 0 }}>
        <span className={styles.name}>{conversation?.creator.display_name ?? '\u00a0'}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
    </>
  );
  return (
    <header className={styles.header}>
      <button type="button" className={styles.iconButton} aria-label={COPY.back} onClick={onBack}>
        <ChevronLeftIcon size={24} />
      </button>
      {conversation ? (
        <Link className={styles.creator} to={`/creators/${conversation.creator.public_code}`}>
          {identity}
        </Link>
      ) : (
        <div className={styles.creator}>{identity}</div>
      )}
      {/* No menu is designed for it yet: it only says so (see the plan). */}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={COPY.options}
        onClick={onOptions}
      >
        <DotsIcon size={24} />
      </button>
    </header>
  );
}

/**
 * Customer side of a private chat (US-026): `Chat`, `ChatExpired` and the loading frame of
 * `StatesAccess`. History stays readable whatever the access state; only the composer changes.
 * No AI / Manual label and no read ticks (US-030) appear here.
 */
function ChatScreen({ api }: { api: MiniappApi }) {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';
  const { state, send, retry, loadOlder, reload, refresh, peerReadSeq } = useChat(
    api,
    conversationId,
  );
  // A thumbnail link expires after 15 minutes; one refetch (at most every 30 s) brings fresh ones.
  const lastRefresh = useRef(0);
  const onThumbnailError = useCallback(() => {
    if (Date.now() - lastRefresh.current < 30_000) return;
    lastRefresh.current = Date.now();
    void refresh();
  }, [refresh]);
  const [flash, showFlash] = useFlashMessage();
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState(false);
  const renewBusy = useRef(false);

  const goBack = () => void navigate('/chats');
  const notYet = () => showFlash(COPY.gap.notYet);

  if (state.status === 'loading') {
    return (
      <div className={styles.page} role="status" aria-live="polite">
        <Header
          conversation={null}
          subtitle={COPY.loadingHistory}
          onBack={goBack}
          onOptions={notYet}
        />
        <Skeletons />
        <Composer onSend={() => false} />
      </div>
    );
  }
  if (state.status === 'error') return <ErrorScreen kind="network" onRetry={reload} />;
  if (state.status === 'not-found') {
    return (
      <div className={styles.page}>
        <Header conversation={null} subtitle="" onBack={goBack} onOptions={notYet} />
        <div className={styles.center}>{COPY.gap.notFound}</div>
      </div>
    );
  }

  const { conversation } = state;
  const access = conversation.access;
  const subtitle =
    access.state === 'ACTIVE' && access.ends_at
      ? COPY.accessUntil(formatDateTime(access.ends_at, timeZone, DATE))
      : access.state === 'CREATOR_BLOCKED'
        ? COPY.creatorBlocked.subtitle
        : COPY.expired.subtitle;

  const renew = async () => {
    if (renewBusy.current) return;
    renewBusy.current = true;
    setRenewing(true);
    setRenewError(false);
    try {
      try {
        await api.requestAccess(conversation.creator.public_code);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'ACCESS_ALREADY_ACTIVE')) throw error;
      }
      // The profile shows the result (pending request) the way US-023 designed it.
      void navigate(`/creators/${conversation.creator.public_code}`);
    } catch {
      // Only a failure frees the button; after success the page is left.
      setRenewError(true);
      renewBusy.current = false;
      setRenewing(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header conversation={conversation} subtitle={subtitle} onBack={goBack} onOptions={notYet} />
      <ThreadBody
        state={state}
        timeZone={timeZone}
        isMine={(m) => m.sender === 'ME'}
        readThroughSeq={peerReadSeq}
        loadOlder={loadOlder}
        retry={retry}
        onOpenAttachment={(_message, attachment) =>
          void navigate(`/chats/${conversationId}/media/${attachment.id}`)
        }
        onThumbnailError={onThumbnailError}
        mediaVariant="customer"
        footer={
          access.state === 'EXPIRED' && access.ended_at ? (
            <div className={styles.endedPill}>
              <ClockIcon size={16} strokeWidth={2} />
              {COPY.expired.endedAt(
                `${formatDateTime(access.ended_at, timeZone, DATE)}, ${formatTime(access.ended_at, timeZone)} ${zoneLabel(timeZone)}`,
              )}
            </div>
          ) : null
        }
      />

      {access.state === 'ACTIVE' ? (
        <Composer onSend={send} />
      ) : (
        <section className={styles.panel}>
          <div className={styles.panelTitle}>
            <ClockIcon size={22} strokeWidth={2} />
            {access.state === 'EXPIRED' ? COPY.expired.title : COPY.creatorBlocked.title}
          </div>
          <p className={styles.panelText}>
            {access.state === 'EXPIRED' ? COPY.expired.text : COPY.creatorBlocked.text}
          </p>
          {access.state === 'EXPIRED' ? (
            <div className={styles.renewWrap}>
              <button
                type="button"
                className={styles.renew}
                disabled={renewing}
                onClick={() => void renew()}
              >
                {COPY.expired.action}
              </button>
              {renewError ? (
                <p className={styles.panelError} role="alert">
                  {COPY.gap.requestFailed}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
      <BottomToast message={flash} kind="info" bottom={112} />
    </div>
  );
}

/** `/chats/:conversationId` and, over it, the file viewer `/chats/:conversationId/media/:attachmentId` (US-037). */
export function ChatPage({ api }: { api: MiniappApi }) {
  return (
    <>
      <ChatScreen api={api} />
      <Outlet />
    </>
  );
}
