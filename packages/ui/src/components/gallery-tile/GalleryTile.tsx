import { AlertCircleIcon, CheckIcon, ImageIcon, PlayIcon } from '../../icons';
import { formatDuration } from '../../format/duration';
import styles from './GalleryTile.module.css';

export type GalleryTileProps =
  | {
      state: 'ready';
      kind: 'PHOTO' | 'VIDEO';
      /** Short-lived signed thumbnail link. Missing shows a neutral placeholder, never the original. */
      thumbnailUrl: string | null;
      durationSeconds?: number | null;
      /** The "Baru" chip on a just-uploaded item. */
      isNew?: boolean;
      selected?: boolean;
      /** `portrait` (4:5) is the creator profile's grid; the creator's own gallery is square. */
      aspect?: 'square' | 'portrait';
      /** Makes the tile a button. */
      onOpen?: () => void;
      /** Text alternative, e.g. "Buka foto". */
      label: string;
      /** The thumbnail link failed (expired): the page can fetch fresh ones. */
      onThumbnailError?: () => void;
    }
  | { state: 'uploading'; progress: number }
  | { state: 'failed'; onRetry: () => void };

/** One square of the creator gallery grid (`CrMain`, `CrGallery*`). Presentational only. */
export function GalleryTile(props: GalleryTileProps) {
  if (props.state === 'uploading') {
    const value = Math.min(100, Math.max(0, Math.round(props.progress)));
    return (
      <div className={styles.cell}>
        <div className={styles.frame}>
          <div className={styles.overlay}>
            <span
              role="progressbar"
              aria-label="Mengunggah"
              aria-valuenow={value}
              aria-valuemin={0}
              aria-valuemax={100}
              className={styles.progress}
            >
              {value}%
              <span className={styles.track}>
                <span className={styles.bar} style={{ display: 'block', width: `${value}%` }} />
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (props.state === 'failed') {
    return (
      <div className={styles.cell}>
        <button
          type="button"
          aria-label="Unggahan gagal. Coba lagi"
          className={`${styles.frame} ${styles.failed}`}
          onClick={props.onRetry}
        >
          <AlertCircleIcon size={26} strokeWidth={2} />
          Gagal
          <span className={styles.retry}>Coba Lagi</span>
        </button>
      </div>
    );
  }

  const inner = (
    <>
      {props.thumbnailUrl ? (
        <img
          className={styles.image}
          src={props.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={props.onThumbnailError}
        />
      ) : (
        <span className={styles.placeholder} data-testid="tile-placeholder">
          <ImageIcon size={28} />
        </span>
      )}
      {props.kind === 'VIDEO' && props.durationSeconds != null ? (
        <span className={styles.duration}>
          <PlayIcon size={14} />
          {formatDuration(props.durationSeconds)}
        </span>
      ) : null}
    </>
  );
  const frameClass = [styles.frame, props.aspect === 'portrait' ? styles.portrait : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`${styles.cell} ${props.selected ? styles.cellSelected : ''}`.trim()}>
      {props.onOpen ? (
        <button
          type="button"
          className={frameClass}
          aria-label={props.label}
          {...(props.selected !== undefined ? { 'aria-pressed': props.selected } : {})}
          onClick={props.onOpen}
        >
          {inner}
        </button>
      ) : (
        <div className={frameClass} role="img" aria-label={props.label}>
          {inner}
        </div>
      )}
      {props.isNew ? <span className={styles.fresh}>Baru</span> : null}
      {props.selected ? (
        <span className={styles.check} aria-hidden="true">
          <CheckIcon size={16} strokeWidth={2.4} />
        </span>
      ) : null}
    </div>
  );
}
