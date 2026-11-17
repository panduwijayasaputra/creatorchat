import { ImageIcon, PlayIcon, formatDuration } from '@creatorchat/ui';
import type { ReactNode } from 'react';
import type { ThreadAttachment } from './useChat';
import styles from './chat.module.css';

/**
 * A message with a photo or video (`CrChatSent`): the file at 240 x 150, the text under it, then the
 * time and the optional tags (read tick, "Manual"). The same bubble serves both sides of the chat;
 * `onOpen` (the viewer, US-037) makes the file a button.
 */
export function MediaBubble({
  attachment,
  body,
  mine,
  time,
  meta,
  failed = false,
  variant = 'creator',
  onOpen,
  onThumbnailError,
}: {
  attachment: Pick<ThreadAttachment, 'kind' | 'duration_seconds' | 'thumbnail_url'>;
  body: string | null;
  mine: boolean;
  time: ReactNode;
  /** Tags after the time: the read tick, "Manual", "Mengirim…". */
  meta?: ReactNode;
  failed?: boolean;
  /** `customer` is the Chat board's smaller frame with a play button; `creator` follows CrChatSent. */
  variant?: 'customer' | 'creator';
  onOpen?: () => void;
  onThumbnailError?: () => void;
}) {
  const customer = variant === 'customer';
  const video = attachment.kind === 'VIDEO';
  const label = !video
    ? 'Buka foto'
    : customer
      ? `Putar video${attachment.duration_seconds !== null ? ` ${formatDuration(attachment.duration_seconds)}` : ''}`
      : 'Buka video';
  const inner = (
    <>
      {attachment.thumbnail_url ? (
        <img
          className={styles.mediaImage}
          src={attachment.thumbnail_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={onThumbnailError}
        />
      ) : (
        <span className={styles.mediaPlaceholder}>
          <ImageIcon size={28} />
        </span>
      )}
      {video && customer ? (
        <span className={styles.mediaPlay} aria-hidden="true">
          <PlayIcon size={24} />
        </span>
      ) : null}
      {video && attachment.duration_seconds !== null ? (
        <span className={styles.mediaDuration}>
          {customer ? null : <PlayIcon size={14} />}
          {formatDuration(attachment.duration_seconds)}
        </span>
      ) : null}
    </>
  );
  return (
    <div
      className={`${styles.bubble} ${styles.mediaBubble} ${customer ? styles.mediaCustomer : ''} ${mine ? styles.mine : ''} ${failed ? styles.failedBubble : ''}`}
      data-testid="media-bubble"
    >
      {onOpen ? (
        <button
          type="button"
          className={`${styles.mediaFrame} ${video ? styles.mediaFrameVideo : ''}`}
          aria-label={label}
          onClick={onOpen}
        >
          {inner}
        </button>
      ) : (
        <div
          className={styles.mediaFrame}
          role="img"
          aria-label={attachment.kind === 'VIDEO' ? 'Video' : 'Foto'}
        >
          {inner}
        </div>
      )}
      {body ? <div className={styles.mediaText}>{body}</div> : null}
      <div className={styles.mediaMeta}>
        {time}
        {meta}
      </div>
    </div>
  );
}
