import { useRef, useState } from 'react';
import { CHAT_TEXT_MAX } from '@creatorchat/contracts';
import {
  ImageIcon,
  LockIcon,
  MegaphoneIcon,
  PlayIcon,
  RefreshIcon,
  UploadIcon,
  UsersIcon,
  formatDuration,
} from '@creatorchat/ui';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { BackWhileOpen, MediaPicker, UploadOverlay } from '../media-picker/MediaPicker';
import sheet from '../creator-chat/attach/attach.module.css';
import type { PutFile } from '../gallery/upload-file';
import { BROADCAST_COPY as C } from './broadcast-copy';
import { useBroadcast, type BroadcastApi } from './useBroadcast';
import styles from './broadcast.module.css';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/**
 * The creator's broadcast composer (`CrBroadcast` and its states): one photo or video, an optional
 * text, one confirmation, then the server delivers to every active subscriber. Which subscribers
 * receive it is never decided here.
 */
export function BroadcastPage({
  api,
  put,
  pollMs,
}: {
  api: BroadcastApi;
  /** Tests only: the upload transport and the status polling interval. */
  put?: PutFile;
  pollMs?: number;
}) {
  const [flash, showFlash] = useFlashMessage();
  const [flashKind, setFlashKind] = useState<'success' | 'info'>('success');
  const input = useRef<HTMLInputElement>(null);
  const flow = useBroadcast(api, {
    ...(put ? { put } : {}),
    ...(pollMs !== undefined ? { pollMs } : {}),
    onSent: () => {
      setFlashKind('success');
      showFlash(C.done);
    },
    onNotice: (text) => {
      setFlashKind('info');
      showFlash(text);
    },
  });
  const { state } = flow;
  const media = state.media;
  const hasMedia = media !== null || state.upload !== null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{C.title}</h1>
      </header>

      <div className={styles.target}>
        <UsersIcon size={22} strokeWidth={1.75} />
        <div>
          <div className={styles.targetTitle}>{C.target.title}</div>
          <div className={styles.targetText}>{C.target.text}</div>
        </div>
      </div>

      <div className={hasMedia ? `${styles.body} ${styles.bodyWithMedia}` : styles.body}>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className={styles.hidden}
          aria-label="Pilih file"
          data-testid="broadcast-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) flow.startUpload(file);
          }}
        />

        {hasMedia ? (
          <>
            <div className={styles.media}>
              {media?.file.thumbnailUrl ? (
                <img src={media.file.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
              ) : null}
              {media?.file.kind === 'VIDEO' && media.file.durationSeconds !== null ? (
                <span className={styles.duration}>
                  <PlayIcon size={14} />
                  {formatDuration(media.file.durationSeconds)}
                </span>
              ) : null}
              {state.upload ? (
                <UploadOverlay upload={state.upload} onRetry={flow.retryUpload} />
              ) : null}
            </div>
            <div className={styles.changeRow}>
              <button type="button" className={styles.change} onClick={flow.changeMedia}>
                <RefreshIcon size={18} strokeWidth={2} />
                {C.change}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.empty}>
              <ImageIcon size={32} strokeWidth={1.75} />
              {C.empty}
            </div>
            <div className={styles.options}>
              <button
                type="button"
                className={`${styles.option} ${styles.optionGallery}`}
                onClick={flow.openPicker}
              >
                <ImageIcon size={18} strokeWidth={2} />
                {C.gallery}
              </button>
              <button
                type="button"
                className={`${styles.option} ${styles.optionUpload}`}
                onClick={() => input.current?.click()}
              >
                <UploadIcon size={18} strokeWidth={2} />
                {C.upload}
              </button>
            </div>
          </>
        )}

        <input
          type="text"
          className={hasMedia ? styles.field : `${styles.field} ${styles.fieldGap}`}
          aria-label={C.fieldLabel}
          placeholder={C.placeholder}
          value={state.body}
          maxLength={CHAT_TEXT_MAX}
          autoComplete="off"
          onChange={(e) => flow.setBody(e.target.value)}
        />

        {media?.source === 'GALLERY' ? (
          <div className={`${styles.note} ${styles.noteGap}`}>
            <ImageIcon size={18} strokeWidth={2} />
            <span>{C.noteGallery}</span>
          </div>
        ) : null}
        {media?.source === 'UPLOAD' ? (
          <div className={styles.save}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={state.saveToGallery}
                onChange={(e) => flow.setSaveToGallery(e.target.checked)}
              />
              {C.saveToGallery}
            </label>
            <div className={`${styles.note} ${styles.noteUnderCheck}`}>
              {state.saveToGallery ? (
                <ImageIcon size={18} strokeWidth={2} />
              ) : (
                <LockIcon size={18} strokeWidth={2} />
              )}
              <span>{state.saveToGallery ? C.noteChecked : C.noteUnchecked}</span>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          className={styles.send}
          disabled={!flow.canSend}
          onClick={flow.askConfirm}
        >
          <MegaphoneIcon size={20} strokeWidth={2} />
          {C.send}
        </button>
        {state.error ? (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        ) : null}
      </div>

      {state.step === 'pick' ? (
        <>
          <BackWhileOpen onBack={flow.closePicker} />
          <MediaPicker api={api} onBack={flow.closePicker} onNext={flow.pickFromGallery} />
        </>
      ) : null}

      {state.confirming ? (
        <>
          <BackWhileOpen onBack={flow.cancelConfirm} />
          <div
            className={sheet.backdrop}
            aria-hidden="true"
            onClick={state.sending ? undefined : flow.cancelConfirm}
          />
          <div
            className={`${sheet.sheet} ${styles.confirmSheet}`}
            role="dialog"
            aria-modal="true"
            aria-label={C.confirm.title}
          >
            <div className={sheet.handle} />
            <h2 className={sheet.sheetTitle}>{C.confirm.title}</h2>
            <p className={styles.confirmText}>{C.confirm.text}</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmSend}
                disabled={state.sending}
                onClick={() => void flow.confirmSend()}
              >
                <MegaphoneIcon size={20} strokeWidth={2} />
                {state.sending ? C.gap.sending : C.send}
              </button>
              <button
                type="button"
                className={styles.confirmCancel}
                disabled={state.sending}
                onClick={flow.cancelConfirm}
              >
                {C.confirm.cancel}
              </button>
            </div>
          </div>
        </>
      ) : null}

      <BottomToast message={flash} bottom={100} kind={flashKind} />
    </div>
  );
}
