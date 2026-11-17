import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { CHAT_TEXT_MAX } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ClockIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshIcon,
  SendIcon,
} from '@creatorchat/ui';
import { formatTime } from '../format/date-time';
import { groupByDay } from './chat-model';
import { MediaBubble } from './MediaBubble';
import { CHAT_COPY as COPY } from './chat-copy';
import type { ThreadAttachment, ThreadMessage, ThreadState, UnsentMessage } from './useChat';
import styles from './chat.module.css';

/** The double tick of `Chat` ("Dibaca"). */
function ReadTick() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--rose)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d="M1.5 12.8l4.2 4.2L14.5 8M9.5 15.5l1.5 1.5L21 7.5" />
    </svg>
  );
}

export function Bubble({
  message,
  mine,
  manualTag = false,
  read = false,
  timeZone,
  onOpenAttachment,
  onThumbnailError,
  mediaVariant,
}: {
  message: { body: string | null; created_at: string; attachments?: ThreadAttachment[] };
  mine: boolean;
  /** The pencil "Manual" tag of the creator's own bubbles (CrChatManual). */
  manualTag?: boolean;
  /** Customer only: the creator has read this message (shown on the latest one, US-030). */
  read?: boolean;
  timeZone: string;
  /** Makes the photo or video a button (the viewer, US-037). */
  onOpenAttachment?: (attachment: ThreadAttachment) => void;
  onThumbnailError?: () => void;
  mediaVariant?: 'customer' | 'creator';
}) {
  const time = formatTime(message.created_at, timeZone);
  const tags = (
    <>
      {read ? (
        <>
          <ReadTick />
          <span>{COPY.read}</span>
        </>
      ) : null}
      {manualTag ? (
        <span className={styles.manualTag}>
          <PencilIcon size={14} strokeWidth={2} />
          {COPY.manual}
        </span>
      ) : null}
    </>
  );
  const attachment = message.attachments?.[0];
  if (attachment) {
    const open = onOpenAttachment;
    return (
      <MediaBubble
        attachment={attachment}
        body={message.body}
        mine={mine}
        time={time}
        meta={tags}
        {...(open ? { onOpen: () => open(attachment) } : {})}
        {...(onThumbnailError ? { onThumbnailError } : {})}
        {...(mediaVariant ? { variant: mediaVariant } : {})}
      />
    );
  }
  return (
    <div className={`${styles.bubble} ${mine ? styles.mine : ''}`}>
      <div className={styles.text}>{message.body}</div>
      <div className={styles.meta}>
        {time}
        {tags}
      </div>
    </div>
  );
}

function UnsentBubble({ message, onRetry }: { message: UnsentMessage; onRetry: () => void }) {
  const failed = message.status === 'failed';
  const status = failed ? (
    <>
      <AlertCircleIcon size={14} strokeWidth={2} color="var(--err-fg)" />
      <span className={styles.failedLabel}>{COPY.failed}</span>
    </>
  ) : (
    <>
      <ClockIcon size={14} strokeWidth={2} />
      <span>{COPY.sending}</span>
    </>
  );
  return (
    <>
      {message.media ? (
        <MediaBubble
          attachment={{
            kind: message.media.kind,
            duration_seconds: message.media.durationSeconds,
            thumbnail_url: message.media.thumbnailUrl,
          }}
          body={message.body || null}
          mine
          time={null}
          meta={status}
          failed={failed}
        />
      ) : (
        <div className={`${styles.bubble} ${styles.mine} ${failed ? styles.failedBubble : ''}`}>
          <div className={styles.text}>{message.body}</div>
          <div className={styles.meta}>{status}</div>
        </div>
      )}
      {failed ? (
        <div className={styles.retryRow}>
          <button type="button" className={styles.retry} onClick={onRetry}>
            <RefreshIcon size={18} strokeWidth={2} />
            {COPY.retry}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function Skeletons() {
  const shapes: [string, number][] = [
    ['other', 200],
    ['mine', 240],
    ['other', 160],
    ['other', 220],
    ['mine', 180],
  ];
  return (
    <div className={styles.skeletons} aria-hidden="true">
      {shapes.map(([side, width], i) => (
        <div
          key={i}
          className={`${styles.skeleton} ${side === 'mine' ? styles.skeletonMine : styles.skeletonOther}`}
          style={{ width }}
        />
      ))}
    </div>
  );
}

export function Composer({
  onSend,
  label = COPY.composerLabel,
  onAttach,
}: {
  onSend: (text: string) => boolean;
  label?: string;
  /** The "Lampirkan media" button before the field (creator side, US-036). */
  onAttach?: () => void;
}) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onSend(text)) setText('');
  };
  return (
    <form className={styles.composer} onSubmit={submit}>
      {onAttach ? (
        <button
          type="button"
          className={styles.attachButton}
          aria-label={COPY.attach}
          onClick={onAttach}
        >
          <PaperclipIcon size={22} strokeWidth={2} />
        </button>
      ) : null}
      <input
        type="text"
        className={styles.input}
        aria-label={label}
        placeholder={label}
        value={text}
        maxLength={CHAT_TEXT_MAX}
        enterKeyHint="send"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="submit"
        className={styles.sendButton}
        aria-label={COPY.send}
        disabled={text.trim() === ''}
      >
        <SendIcon size={22} />
      </button>
    </form>
  );
}

type Ready<M extends ThreadMessage, C> = Extract<ThreadState<M, C>, { status: 'ready' }>;

/**
 * The scrolling message list shared by both sides of the chat: day separators, bubbles, unsent
 * bubbles, older pages loaded when the reader scrolls to the top (keeping their place), and the
 * bottom pinned only while the reader is near it. `footer` renders after the last bubble.
 */
export function ThreadBody<M extends ThreadMessage, C>({
  state,
  timeZone,
  isMine,
  manualTag,
  readThroughSeq,
  loadOlder,
  retry,
  footer,
  onOpenAttachment,
  onThumbnailError,
  mediaVariant,
}: {
  state: Ready<M, C>;
  timeZone: string;
  isMine: (message: M) => boolean;
  manualTag?: (message: M) => boolean;
  /** Customer only: the creator's read cursor; "Dibaca" goes under my latest message up to it. */
  readThroughSeq?: number;
  loadOlder: () => Promise<void>;
  retry: (clientMessageId: string) => void;
  footer?: ReactNode;
  /** Makes a message's photo or video a button (the viewer, US-037). */
  onOpenAttachment?: (message: M, attachment: ThreadAttachment) => void;
  /** A thumbnail link failed (expired): the page refetches the latest page once. */
  onThumbnailError?: () => void;
  /** The media bubble's size and look: the customer's (`Chat`) or the creator's (`CrChatSent`). */
  mediaVariant?: 'customer' | 'creator';
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Scroll height before an older page was requested, to keep the reader's place. */
  const anchor = useRef<{ height: number; top: number } | null>(null);
  /** False once the reader scrolled up, so a refetch does not pull them back down. */
  const nearBottom = useRef(true);
  const firstSeq = state.messages[0]?.seq;
  const lastSeq = state.messages[state.messages.length - 1]?.seq;
  const unsentCount = state.unsent.length;
  const failedCount = state.unsent.filter((u) => u.status === 'failed').length;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
  }, [firstSeq]);

  // To the bottom when the chat opens or when I send (or a send fails and shows "Kirim Ulang")...
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [unsentCount, failedCount]);

  // ...and for a new message at the end only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastSeq]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!el || el.scrollTop > 80) return;
    if (state.nextBefore === null || state.older === 'loading' || state.older === 'failed') return;
    anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    void loadOlder();
  }, [state, loadOlder]);

  const readMarkerId =
    readThroughSeq && readThroughSeq > 0
      ? [...state.messages].reverse().find((m) => isMine(m) && m.seq <= readThroughSeq)?.id
      : undefined;
  const groups = groupByDay(state.messages, timeZone, new Date());
  return (
    <div className={styles.body} ref={bodyRef} onScroll={onScroll}>
      <div className={styles.list}>
        {state.older === 'loading' ? (
          <div className={styles.status} role="status">
            {COPY.loadingHistory}
          </div>
        ) : null}
        {state.older === 'failed' ? (
          <div className={styles.status}>
            {COPY.gap.olderFailed}
            <button type="button" className={styles.statusButton} onClick={() => void loadOlder()}>
              {COPY.gap.olderRetry}
            </button>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} style={{ display: 'contents' }}>
            <div className={styles.day}>{group.label}</div>
            {group.messages.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                mine={isMine(m)}
                manualTag={manualTag ? manualTag(m) : false}
                read={m.id === readMarkerId}
                timeZone={timeZone}
                {...(onOpenAttachment ? { onOpenAttachment: (a) => onOpenAttachment(m, a) } : {})}
                {...(onThumbnailError ? { onThumbnailError } : {})}
                {...(mediaVariant ? { mediaVariant } : {})}
              />
            ))}
          </div>
        ))}
        {state.unsent.map((u) => (
          <UnsentBubble
            key={u.clientMessageId}
            message={u}
            onRetry={() => retry(u.clientMessageId)}
          />
        ))}
        {footer}
      </div>
    </div>
  );
}
