import { useRef, useState } from 'react';
import { CHAT_TEXT_MAX } from '@creatorchat/contracts';
import {
  ChevronRightIcon,
  ImageIcon,
  LockIcon,
  PlayIcon,
  SendIcon,
  UploadIcon,
  formatDuration,
} from '@creatorchat/ui';
import type { MiniappApi } from '../../auth/api-client';
import type { UnsentMedia } from '../../chat/useChat';
import { BackWhileOpen, Header, MediaPicker, UploadOverlay } from '../../media-picker/MediaPicker';
import { ATTACH_COPY as C } from './attach-copy';
import type { AttachFlow as Flow, ChatUpload } from './useAttachFlow';
import styles from './attach.module.css';

function Sheet({
  firstName,
  onGallery,
  onUpload,
  onClose,
}: {
  firstName: string;
  onGallery: () => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={C.sheetTitle(firstName)}
      >
        <div className={styles.handle} />
        <h2 className={styles.sheetTitle}>{C.sheetTitle(firstName)}</h2>
        <div className={styles.options}>
          <button type="button" className={styles.option} onClick={onGallery}>
            <span className={styles.optionIcon}>
              <ImageIcon size={22} strokeWidth={2} />
            </span>
            <span className={styles.optionText}>
              <span className={styles.optionTitle}>{C.gallery.title}</span>
              <span className={styles.optionHint}>{C.gallery.text}</span>
            </span>
            <ChevronRightIcon size={20} strokeWidth={2} className={styles.chevron} />
          </button>
          <button type="button" className={styles.option} onClick={onUpload}>
            <span className={styles.optionIcon}>
              <UploadIcon size={22} strokeWidth={2} />
            </span>
            <span className={styles.optionText}>
              <span className={styles.optionTitle}>{C.upload.title}</span>
              <span className={styles.optionHint}>{C.upload.text}</span>
            </span>
            <ChevronRightIcon size={20} strokeWidth={2} className={styles.chevron} />
          </button>
        </div>
      </div>
    </>
  );
}

/** `CrChatPreview` (gallery file) and `CrChatUpload` (new file): the file, an optional message, Kirim. */
function Preview({
  fullName,
  source,
  media,
  upload,
  onBack,
  onChange,
  onRetry,
  onSend,
}: {
  fullName: string;
  source: 'GALLERY' | 'CHAT';
  media: UnsentMedia | null;
  upload: ChatUpload | null;
  onBack: () => void;
  onChange: () => void;
  onRetry: () => void;
  onSend: (media: UnsentMedia, text: string) => boolean;
}) {
  const [text, setText] = useState('');
  return (
    <div className={styles.screen}>
      <Header
        title={C.preview.title(fullName)}
        onBack={onBack}
        action={{ label: C.preview.change, onClick: onChange }}
      />
      <div className={styles.media}>
        {media?.thumbnailUrl ? (
          <img src={media.thumbnailUrl} alt="" referrerPolicy="no-referrer" />
        ) : null}
        {media?.kind === 'VIDEO' && media.durationSeconds !== null ? (
          <span className={styles.duration}>
            <PlayIcon size={14} />
            {formatDuration(media.durationSeconds)}
          </span>
        ) : null}
        {upload ? <UploadOverlay upload={upload} onRetry={onRetry} /> : null}
      </div>
      <div className={styles.scroll}>
        <input
          type="text"
          className={styles.field}
          aria-label={C.preview.fieldLabel}
          placeholder={C.preview.placeholder}
          value={text}
          maxLength={CHAT_TEXT_MAX}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <div className={styles.infoNote}>
          {source === 'GALLERY' ? (
            <ImageIcon size={18} strokeWidth={2} />
          ) : (
            <LockIcon size={18} strokeWidth={2} />
          )}
          <span>{source === 'GALLERY' ? C.preview.galleryNote : C.preview.chatNote}</span>
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.primary}
          disabled={!media}
          onClick={() => media && onSend(media, text)}
        >
          <SendIcon size={20} strokeWidth={2} />
          {C.preview.send}
        </button>
      </div>
    </div>
  );
}

/**
 * The creator's attach flow drawn over the conversation (`CrAttach` → `CrChatPick` / "Upload Baru" →
 * `CrChatPreview` / `CrChatUpload`). `onSend` posts the message through the thread; the flow closes
 * once it was accepted.
 */
export function AttachFlow({
  api,
  flow,
  firstName,
  fullName,
  onSend,
}: {
  api: Pick<MiniappApi, 'getGallery'>;
  flow: Flow;
  firstName: string;
  fullName: string;
  onSend: (media: UnsentMedia, text: string) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { step } = flow;
  if (step.name === 'closed') return null;
  return (
    <>
      <BackWhileOpen onBack={flow.back} />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        className={styles.hidden}
        aria-label="Pilih file"
        data-testid="attach-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) flow.startUpload(file);
        }}
      />
      {step.name === 'sheet' ? (
        <Sheet
          firstName={firstName}
          onGallery={flow.choosePick}
          onUpload={() => input.current?.click()}
          onClose={flow.close}
        />
      ) : null}
      {step.name === 'pick' ? (
        <MediaPicker api={api} onBack={flow.back} onNext={flow.confirmPick} />
      ) : null}
      {step.name === 'preview' ? (
        <Preview
          fullName={fullName}
          source={step.source}
          media={step.media}
          upload={step.upload}
          onBack={flow.back}
          onChange={flow.change}
          onRetry={flow.retryUpload}
          onSend={onSend}
        />
      ) : null}
    </>
  );
}
