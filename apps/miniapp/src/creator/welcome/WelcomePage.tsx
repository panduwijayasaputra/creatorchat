import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { CHAT_TEXT_MAX } from '@creatorchat/contracts';
import {
  CheckIcon,
  ChevronLeftIcon,
  ImageIcon,
  InfoCircleIcon,
  LockIcon,
  PlayIcon,
  RefreshIcon,
  Switch,
  TrashIcon,
  UploadIcon,
  formatDuration,
} from '@creatorchat/ui';
import { BottomToast, useFlashMessage } from '../../components/BottomToast';
import type { PutFile } from '../../gallery/upload-file';
import { BackWhileOpen, MediaPicker, UploadOverlay } from '../../media-picker/MediaPicker';
import { WELCOME_COPY as C } from './welcome-copy';
import { useWelcome, type WelcomeApi } from './useWelcome';
import styles from './welcome.module.css';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

/**
 * `CrWelcome` and its media states (`CrWelcomePick`, `CrWelcomeGallery`, `CrWelcomeUpload`): the
 * creator's welcome message, a draft until "Simpan Pesan". It is sent once to each new subscriber
 * (US-041); nothing here decides who receives it.
 */
export function WelcomePage({
  api,
  put,
  pollMs,
}: {
  api: WelcomeApi;
  /** Tests only: the upload transport and the status polling interval. */
  put?: PutFile;
  pollMs?: number;
}) {
  const [flash, showFlash] = useFlashMessage();
  const [flashKind, setFlashKind] = useState<'success' | 'info'>('success');
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const w = useWelcome(api, {
    ...(put ? { put } : {}),
    ...(pollMs !== undefined ? { pollMs } : {}),
    onSaved: () => {
      setFlashKind('success');
      showFlash(C.gap.saved);
    },
    onNotice: (text) => {
      setFlashKind('info');
      showFlash(text);
    },
  });
  const { media, upload } = w.chosen;
  const hasMedia = media !== null || upload !== null;
  const previewText = w.body.trim();

  const header = (
    <header className={styles.header}>
      <Link to="/settings" className={styles.back} aria-label={C.back}>
        <ChevronLeftIcon size={24} strokeWidth={1.75} />
      </Link>
      <h1 className={styles.headerTitle}>{C.title}</h1>
    </header>
  );

  if (w.load !== 'ready') {
    return (
      <div className={styles.page}>
        {header}
        <div className={styles.status} role={w.load === 'failed' ? 'alert' : 'status'}>
          {w.load === 'failed' ? (
            <>
              {C.gap.loadFailed}
              <br />
              <button type="button" className={styles.retry} onClick={w.retryLoad}>
                {C.gap.retry}
              </button>
            </>
          ) : (
            C.gap.loading
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <div className={styles.scroll}>
        <div className={styles.body}>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className={styles.hidden}
            aria-label="Pilih file"
            data-testid="welcome-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) w.chosen.startUpload(file);
            }}
          />

          <div className={styles.switchRow}>
            <div className={styles.switchText}>
              <div className={styles.switchTitle}>{C.switchTitle}</div>
              <div className={styles.hint}>{w.enabled ? C.switchOn : C.gap.switchOff}</div>
            </div>
            <Switch checked={w.enabled} label={C.switchLabel} onChange={w.setEnabled} />
          </div>

          <div>
            <label className={styles.fieldLabel} htmlFor="welcome-body">
              {C.bodyLabel}
            </label>
            <textarea
              id="welcome-body"
              className={styles.textarea}
              value={w.body}
              maxLength={CHAT_TEXT_MAX}
              onChange={(e) => w.setBody(e.target.value)}
            />
            <div className={`${styles.hint} ${styles.hintBelow}`}>{C.bodyHint}</div>
          </div>

          <div>
            <h2 className={styles.sectionLabel}>{C.mediaLabel}</h2>
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
                  {upload ? <UploadOverlay upload={upload} onRetry={w.chosen.retryUpload} /> : null}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.remove}`}
                    onClick={w.chosen.clear}
                  >
                    <TrashIcon size={18} strokeWidth={2} />
                    {C.remove}
                  </button>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.change}`}
                    onClick={w.chosen.clear}
                  >
                    <RefreshIcon size={18} strokeWidth={2} />
                    {C.change}
                  </button>
                </div>
                {media ? (
                  <div className={styles.note}>
                    {media.source === 'GALLERY' ? (
                      <ImageIcon size={18} strokeWidth={2} />
                    ) : (
                      <LockIcon size={18} strokeWidth={2} />
                    )}
                    <span>{media.source === 'GALLERY' ? C.noteGallery : C.noteUpload}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className={styles.empty}>
                  <ImageIcon size={28} strokeWidth={1.75} />
                  {C.noMedia}
                </div>
                <div className={styles.choices}>
                  <button
                    type="button"
                    className={`${styles.choice} ${styles.choiceGallery}`}
                    onClick={() => setPicking(true)}
                  >
                    <ImageIcon size={18} strokeWidth={2} />
                    {C.gallery}
                  </button>
                  <button
                    type="button"
                    className={`${styles.choice} ${styles.choiceUpload}`}
                    onClick={() => input.current?.click()}
                  >
                    <UploadIcon size={18} strokeWidth={2} />
                    {C.upload}
                  </button>
                </div>
              </>
            )}
          </div>

          <div>
            <h2 className={styles.sectionLabel}>{C.previewLabel}</h2>
            <div className={styles.previewBox}>
              <div className={styles.bubble}>
                {media?.file.thumbnailUrl ? (
                  <div className={styles.bubbleMedia}>
                    <img src={media.file.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
                  </div>
                ) : null}
                <div className={styles.bubbleText}>{previewText}</div>
                <div className={styles.bubbleTime}>{C.previewTime}</div>
              </div>
            </div>
          </div>

          <div className={styles.note}>
            <InfoCircleIcon size={18} strokeWidth={2} />
            <span>{C.footnote}</span>
          </div>

          {w.error ? (
            <p className={styles.error} role="alert">
              {w.error}
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.save}
          disabled={!w.canSave}
          onClick={() => void w.save()}
        >
          <CheckIcon size={20} strokeWidth={2} />
          {w.saving ? C.gap.saving : C.save}
        </button>
      </div>

      {picking ? (
        <>
          <BackWhileOpen onBack={() => setPicking(false)} />
          <MediaPicker
            api={api}
            onBack={() => setPicking(false)}
            onNext={(file) => {
              w.chosen.pickFromGallery(file);
              setPicking(false);
            }}
          />
        </>
      ) : null}

      <BottomToast message={flash} bottom={104} kind={flashKind} />
    </div>
  );
}
