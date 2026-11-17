import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon, formatDuration } from '@creatorchat/ui';
import styles from './media-viewer.module.css';

export interface MediaViewerProps {
  kind: 'PHOTO' | 'VIDEO';
  /** The short-lived signed link. `null` shows `children` (a message) in the media area instead. */
  src: string | null;
  /** "2 / 12". */
  positionLabel: string;
  onClose: () => void;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  /** The file failed to load (usually an expired link): the owner may fetch a fresh one. */
  onMediaError?: () => void;
  /** Length known before the file loads (the video's total until metadata arrives). */
  durationSeconds?: number | null;
  /** The line under the media, e.g. "Diunggah 12 Nov 2026, 06.41 WIB". */
  footer?: ReactNode;
  /** Shown in the media area while `src` is null (loading or failed). */
  children?: ReactNode;
}

function VideoPlayer({
  src,
  durationSeconds,
  onError,
}: {
  src: string;
  durationSeconds: number | null | undefined;
  onError: (() => void) | undefined;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(durationSeconds ?? 0);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [src]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  const ratio = length > 0 ? Math.min(1, time / length) : 0;

  return (
    <>
      <video
        ref={video}
        className={styles.file}
        src={src}
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration);
        }}
        onError={onError}
      />
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.play}
          aria-label={playing ? 'Jeda video' : 'Putar video'}
          onClick={toggle}
        >
          {playing ? (
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className={styles.seek}>
          <div className={styles.trackRow}>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${ratio * 100}%` }} />
              <div className={styles.knob} style={{ left: `${ratio * 100}%` }} />
            </div>
            <input
              type="range"
              className={styles.range}
              aria-label="Posisi video"
              min={0}
              max={Math.max(1, Math.round(length))}
              step={1}
              value={Math.round(time)}
              onChange={(e) => {
                const el = video.current;
                if (el) el.currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
            />
          </div>
          <div className={styles.times}>
            <span>{formatDuration(time)}</span>
            <span>{formatDuration(length)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Full-screen viewer for a photo or a video (`CrViewerPhoto`, `CrViewerVideo`); shared by the creator
 * gallery now and by the subscriber and chat viewers later. It never stores the link it is given.
 */
export function MediaViewer(props: MediaViewerProps) {
  const { kind, src, onPrevious, onNext } = props;
  return (
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label="Penampil media">
      <div className={styles.top}>
        <button type="button" className={styles.round} aria-label="Tutup" onClick={props.onClose}>
          <XIcon size={24} strokeWidth={2} />
        </button>
        <span className={styles.position}>{props.positionLabel}</span>
        <span className={styles.spacer} />
      </div>
      <div className={styles.media}>
        {src === null ? (
          props.children
        ) : kind === 'PHOTO' ? (
          <img className={styles.file} src={src} alt="" onError={props.onMediaError} />
        ) : (
          <VideoPlayer
            key={src}
            src={src}
            durationSeconds={props.durationSeconds}
            onError={props.onMediaError}
          />
        )}
        {onPrevious ? (
          <button
            type="button"
            className={`${styles.nav} ${styles.prev}`}
            aria-label="Media sebelumnya"
            onClick={onPrevious}
          >
            <ChevronLeftIcon size={22} strokeWidth={2} />
          </button>
        ) : null}
        {onNext ? (
          <button
            type="button"
            className={`${styles.nav} ${styles.next}`}
            aria-label="Media berikutnya"
            onClick={onNext}
          >
            <ChevronRightIcon size={22} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {props.footer ? <div className={styles.footer}>{props.footer}</div> : null}
    </div>
  );
}
