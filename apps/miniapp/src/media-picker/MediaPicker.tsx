import { useEffect, useRef, useState } from 'react';
import { AlertCircleIcon, ChevronLeftIcon, GalleryTile } from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import type { UnsentMedia } from '../chat/useChat';
import { useGallery } from '../gallery/useGallery';
import { useBackButton } from '../telegram/useBackButton';
import { ATTACH_COPY as C } from '../creator-chat/attach/attach-copy';
import type { ChatUpload } from '../creator-chat/attach/useAttachFlow';
// The picker and the upload overlay keep the look of the attach flow (`CrChatPick`), so they share its styles.
import styles from '../creator-chat/attach/attach.module.css';

/** Wires Telegram's BackButton to `onBack` while mounted. */
export function BackWhileOpen({ onBack }: { onBack: () => void }) {
  useBackButton(onBack);
  return null;
}

export function Header({
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

/** `CrChatPick`: one photo or video of the creator's own gallery. */
export function MediaPicker({
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

export function UploadOverlay({ upload, onRetry }: { upload: ChatUpload; onRetry: () => void }) {
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
