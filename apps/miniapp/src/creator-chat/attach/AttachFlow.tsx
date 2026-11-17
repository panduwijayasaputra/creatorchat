import { useEffect, useRef, useState } from 'react';
import { CHAT_TEXT_MAX } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GalleryTile,
  ImageIcon,
  LockIcon,
  PlayIcon,
  SendIcon,
  UploadIcon,
  formatDuration,
} from '@creatorchat/ui';
import type { MiniappApi } from '../../auth/api-client';
import type { UnsentMedia } from '../../chat/useChat';
import { useGallery } from '../../gallery/useGallery';
import { useBackButton } from '../../telegram/useBackButton';
import { ATTACH_COPY as C } from './attach-copy';
import type { AttachFlow as Flow, ChatUpload } from './useAttachFlow';
import styles from './attach.module.css';

function BackWhileOpen({ onBack }: { onBack: () => void }) {
  useBackButton(onBack);
  return null;
}

function Header({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <header className={styles.header}>
      <button type="button" className={styles.back} aria-label={C.back} onClick={onBack}>
        <ChevronLeftIcon size={24} strokeWidth={2} />
      </button>
      <h2 className={styles.headerTitle}>{title}</h2>
      {action ? (
        <button type="button" className={styles.change} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </header>
  );
}

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

/** `CrChatPick`: one photo or video of the creator's own gallery. */
function Pick({
  api,
  onBack,
  onNext,
}: {
  api: Pick<MiniappApi, 'getGallery'>;
  onBack: () => void;
  onNext: (media: UnsentMedia) => void;
}) {
  const gallery = useGallery(api);
  const [picked, setPicked] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const state = gallery.state;
  const canLoadMore =
    state.status === 'ready' && state.nextCursor !== null && state.more === 'idle';
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void gallery.loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, gallery]);

  const chosen =
    state.status === 'ready' ? state.items.find((i) => i.asset.id === picked) : undefined;
  return (
    <div className={styles.screen}>
      <Header title={C.pick.title} onBack={onBack} />
      <div className={styles.scroll}>
        <div className={styles.hint}>{C.pick.hint}</div>
        {state.status === 'loading' ? (
          <div className={styles.grid} role="status" aria-label="Memuat" aria-busy="true">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} aria-hidden="true" className={styles.skeleton} />
            ))}
          </div>
        ) : state.status === 'error' ? (
          <p className={styles.note}>
            {C.gap.pickFailed}
            <button type="button" className={styles.noteAction} onClick={gallery.retry}>
              {C.gap.pickRetry}
            </button>
          </p>
        ) : state.items.length === 0 ? (
          <p className={styles.note}>
            <strong>{C.gap.emptyPicker}</strong>
            <br />
            {C.gap.emptyPickerText}
          </p>
        ) : (
          <>
            <div className={styles.grid}>
              {state.items.map((item) => (
                <GalleryTile
                  key={item.asset.id}
                  state="ready"
                  kind={item.asset.kind}
                  thumbnailUrl={item.asset.thumbnail_url}
                  durationSeconds={item.asset.duration_seconds}
                  selected={picked === item.asset.id}
                  label={item.asset.kind === 'VIDEO' ? 'Pilih video' : 'Pilih foto'}
                  onOpen={() => setPicked(item.asset.id)}
                />
              ))}
            </div>
            {state.more === 'failed' ? (
              <p className={styles.note}>
                {C.gap.pickFailed}
                <button
                  type="button"
                  className={styles.noteAction}
                  onClick={() => void gallery.loadMore()}
                >
                  {C.gap.pickRetry}
                </button>
              </p>
            ) : null}
            <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
          </>
        )}
      </div>
      <div className={styles.bottom}>
        <div className={styles.pickBar}>
          <span className={styles.count}>{chosen ? C.pick.selected : C.gap.nothingPicked}</span>
          <div className={styles.pickAction}>
            <button
              type="button"
              className={styles.primary}
              disabled={!chosen}
              onClick={() =>
                chosen &&
                onNext({
                  assetId: chosen.asset.id,
                  kind: chosen.asset.kind,
                  durationSeconds: chosen.asset.duration_seconds,
                  thumbnailUrl: chosen.asset.thumbnail_url ?? '',
                })
              }
            >
              {C.pick.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadOverlay({ upload, onRetry }: { upload: ChatUpload; onRetry: () => void }) {
  if (upload.phase === 'failed') {
    const network = upload.failure?.kind !== 'rejected';
    return (
      <div className={styles.failure} role="alert">
        <AlertCircleIcon size={26} strokeWidth={2} />
        {C.gap.uploadFailed}
        <span className={styles.failureText}>
          {network ? C.gap.uploadFailedNetwork : C.gap.uploadFailedRejected}
        </span>
        <button type="button" className={styles.retry} onClick={onRetry}>
          {C.gap.retry}
        </button>
      </div>
    );
  }
  const value = Math.min(100, Math.max(0, Math.round(upload.progress)));
  return (
    <div className={styles.overlay}>
      <span
        role="progressbar"
        aria-label="Mengunggah"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          width: '100%',
        }}
      >
        {upload.phase === 'processing' ? C.gap.preparing : `${value}%`}
        <span className={styles.track}>
          <span className={styles.bar} style={{ width: `${value}%` }} />
        </span>
      </span>
    </div>
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
        <Pick api={api} onBack={flow.back} onNext={flow.confirmPick} />
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
