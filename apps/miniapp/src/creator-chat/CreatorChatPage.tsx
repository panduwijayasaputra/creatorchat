import { useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeftIcon, ClockIcon, InfoCircleIcon } from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorScreen } from '../auth/screens/AuthGate';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { Composer, Skeletons, ThreadBody } from '../chat/ChatThread';
import { formatDateTime, formatTime, zoneLabel } from '../format/date-time';
import type { PutFile } from '../gallery/upload-file';
import { ATTACH_COPY } from './attach/attach-copy';
import { AttachFlow } from './attach/AttachFlow';
import { useAttachFlow } from './attach/useAttachFlow';
import { CREATOR_CHAT_COPY as COPY } from './creator-chat-copy';
import { InitialsAvatar } from './InitialsAvatar';
import { useCreatorChat } from './useCreatorChat';
import chat from '../chat/chat.module.css';
import styles from './creator-chat.module.css';

const DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;

function Header({
  conversationId,
  name,
  avatarUrl,
  subtitle,
  onBack,
}: {
  conversationId: string;
  name: string | null;
  avatarUrl: string | null;
  subtitle: string;
  onBack: () => void;
}) {
  const identity = (
    <>
      <InitialsAvatar name={name ?? ''} url={avatarUrl} seed={conversationId} size={40} />
      <span style={{ minWidth: 0 }}>
        <span className={chat.name}>{name ?? ' '}</span>
        <span className={chat.subtitle}>{subtitle}</span>
      </span>
    </>
  );
  return (
    <header className={chat.header}>
      <button type="button" className={chat.iconButton} aria-label={COPY.back} onClick={onBack}>
        <ChevronLeftIcon size={24} />
      </button>
      {name ? (
        <Link className={chat.creator} to={`/inbox/${conversationId}/customer`}>
          {identity}
        </Link>
      ) : (
        <div className={chat.creator}>{identity}</div>
      )}
      {name ? (
        <Link
          className={chat.iconButton}
          to={`/inbox/${conversationId}/customer`}
          aria-label={COPY.customerDetail}
        >
          <InfoCircleIcon size={24} />
        </Link>
      ) : (
        <span className={chat.iconButton} />
      )}
    </header>
  );
}

/**
 * The creator's side of a private chat (US-029): `CrChatManual` and `CrChatExpired`. History stays
 * readable whatever the access state; when the customer's access is not active only the composer
 * changes. The Manual / AI panel is a later phase and is not shown. "Lampirkan media" (US-036) opens
 * the attach flow over the conversation.
 */
export function CreatorChatPage({
  api,
  put,
  pollMs,
}: {
  api: MiniappApi;
  /** Tests only: the upload transport and the status polling interval. */
  put?: PutFile;
  pollMs?: number;
}) {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';
  const { state, send, sendMedia, retry, loadOlder, reload, refresh } = useCreatorChat(
    api,
    conversationId,
  );
  const [flash, showFlash] = useFlashMessage();
  const attach = useAttachFlow(api, {
    conversationId,
    ...(put ? { put } : {}),
    ...(pollMs !== undefined ? { pollMs } : {}),
    onRefused: (why) =>
      showFlash(
        why.reason === 'type'
          ? ATTACH_COPY.gap.refusedType
          : ATTACH_COPY.gap.refusedSize(why.maxMb),
      ),
  });
  // A thumbnail link expires after 15 minutes; one refetch (at most every 30 s) brings fresh ones.
  const lastRefresh = useRef(0);
  const onThumbnailError = useCallback(() => {
    if (Date.now() - lastRefresh.current < 30_000) return;
    lastRefresh.current = Date.now();
    void refresh();
  }, [refresh]);
  const goBack = () => void navigate('/inbox');

  if (state.status === 'loading') {
    return (
      <div className={chat.page} role="status" aria-live="polite">
        <Header
          conversationId={conversationId}
          name={null}
          avatarUrl={null}
          subtitle={COPY.loadingHistory}
          onBack={goBack}
        />
        <Skeletons />
        <Composer onSend={() => false} label={COPY.composerLabel} />
      </div>
    );
  }
  if (state.status === 'error') return <ErrorScreen kind="network" onRetry={reload} />;
  if (state.status === 'not-found') {
    return (
      <div className={chat.page}>
        <Header
          conversationId={conversationId}
          name={null}
          avatarUrl={null}
          subtitle=""
          onBack={goBack}
        />
        <div className={chat.center}>{COPY.gap.notFound}</div>
      </div>
    );
  }

  const { conversation } = state;
  const { access, customer } = conversation;
  const active = access.state === 'ACTIVE';
  const subtitle =
    active && access.ends_at
      ? COPY.accessUntil(formatDateTime(access.ends_at, timeZone, DATE))
      : COPY.expired.subtitle;

  return (
    <div className={chat.page}>
      <Header
        conversationId={conversationId}
        name={customer.display_name}
        avatarUrl={customer.avatar_url}
        subtitle={subtitle}
        onBack={goBack}
      />
      {active ? null : (
        <div className={styles.strip}>
          <span className={styles.stripChip}>
            <ClockIcon size={16} strokeWidth={2} />
            {COPY.expired.title}
          </span>
          <div className={styles.stripText}>{COPY.expired.text}</div>
        </div>
      )}
      <ThreadBody
        state={state}
        timeZone={timeZone}
        isMine={(m) => m.sender === 'ME'}
        manualTag={(m) => m.sender === 'ME' && m.origin === 'MANUAL'}
        loadOlder={loadOlder}
        retry={retry}
        onThumbnailError={onThumbnailError}
        footer={
          !active && access.ended_at ? (
            <div className={chat.endedPill}>
              <ClockIcon size={16} strokeWidth={2} />
              {COPY.expired.endedAt(
                `${formatDateTime(access.ended_at, timeZone, DATE)}, ${formatTime(access.ended_at, timeZone)} ${zoneLabel(timeZone)}`,
              )}
            </div>
          ) : null
        }
      />
      {active ? (
        <Composer onSend={send} label={COPY.composerLabel} onAttach={attach.open} />
      ) : (
        <section className={chat.panel}>
          <div className={styles.panelBody}>
            <ClockIcon size={22} strokeWidth={2} className={styles.panelIcon} />
            <div>
              <div className={styles.panelHead}>{COPY.expired.panelTitle}</div>
              <div className={styles.panelSub}>{COPY.expired.panelText}</div>
            </div>
          </div>
        </section>
      )}
      {active ? (
        <AttachFlow
          api={api}
          flow={attach}
          firstName={customer.display_name.split(' ')[0] ?? customer.display_name}
          fullName={customer.display_name}
          onSend={(media, text) => {
            const accepted = sendMedia(media, text);
            if (accepted) {
              attach.close();
              showFlash(ATTACH_COPY.sent);
            }
            return accepted;
          }}
        />
      ) : null}
      <BottomToast message={flash} bottom={130} />
    </div>
  );
}
