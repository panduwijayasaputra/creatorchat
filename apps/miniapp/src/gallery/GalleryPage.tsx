import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import type { MediaLimits } from '@creatorchat/contracts';
import {
  AlertCircleIcon,
  GalleryTile,
  ImageIcon,
  LockIcon,
  RefreshIcon,
  UploadIcon,
} from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { BottomToast, useFlashMessage } from '../components/BottomToast';
import { GALLERY_COPY as COPY } from './gallery-copy';
import { useGallery } from './useGallery';
import { useUploads, type Upload } from './useUploads';
import type { PutFile } from './upload-file';
import styles from './gallery.module.css';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

function bannerText(upload: Upload): string {
  const failure = upload.failure;
  if (!failure || failure.kind === 'network') return COPY.failedBanner.network;
  const reasons: Record<string, string> = COPY.gap.rejected;
  return reasons[failure.code ?? 'OTHER'] ?? COPY.gap.rejected.OTHER;
}

/**
 * The creator's gallery (US-032): `CrGallery`, `CrGalleryUploading`, `CrGalleryDone` and the three
 * `CrStatesGallery` frames. Tiles are not opened yet (the viewer is US-033).
 */
function GalleryScreen({
  api,
  put,
  pollMs,
}: {
  api: MiniappApi;
  /** Tests only: the upload transport and the status polling interval. */
  put?: PutFile;
  pollMs?: number;
}) {
  const gallery = useGallery(api);
  const navigate = useNavigate();
  const [flash, showFlash] = useFlashMessage();
  const [limits, setLimits] = useState<MediaLimits | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api.getMediaLimits().then(
      (l) => live && setLimits(l),
      () => undefined, // without limits the server still refuses a bad file
    );
    return () => {
      live = false;
    };
  }, [api]);

  const { uploads, start, retry } = useUploads(api, {
    limits,
    ...(put ? { put } : {}),
    ...(pollMs !== undefined ? { pollMs } : {}),
    onReady: (asset) => {
      gallery.prepend(asset);
      showFlash(COPY.uploaded);
    },
    onRefused: (why) =>
      showFlash(why.reason === 'type' ? COPY.gap.refused.type : COPY.gap.refused.size(why.maxMb)),
  });

  // Thumbnail links expire; one refetch brings fresh ones (at most one per 30 s).
  const lastRefresh = useRef(0);
  const onThumbnailError = useCallback(() => {
    if (Date.now() - lastRefresh.current < 30_000) return;
    lastRefresh.current = Date.now();
    void gallery.refresh();
  }, [gallery]);

  const sentinel = useRef<HTMLDivElement>(null);
  const ready = gallery.state.status === 'ready' ? gallery.state : null;
  const canLoadMore = ready !== null && ready.nextCursor !== null && ready.more === 'idle';
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void gallery.loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, gallery]);

  const choose = () => input.current?.click();
  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      className={styles.hidden}
      aria-label="Pilih file"
      data-testid="file-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) start(file);
      }}
    />
  );
  const uploadButton = (
    <button type="button" className={styles.upload} onClick={choose}>
      <UploadIcon size={20} strokeWidth={2} />
      {COPY.upload}
    </button>
  );
  const heading = (button: boolean) => (
    <div className={styles.header}>
      <h1 className={styles.title}>{COPY.title}</h1>
      {button ? uploadButton : null}
    </div>
  );

  if (gallery.state.status === 'loading') {
    return (
      <div className={styles.page}>
        {heading(true)}
        <div role="status" aria-label="Memuat" aria-busy="true" className={styles.skeletonGrid}>
          <div className={styles.grid}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} aria-hidden="true" className={styles.skeletonTile} />
            ))}
          </div>
        </div>
        {picker}
      </div>
    );
  }

  if (gallery.state.status === 'error') {
    return (
      <div className={styles.page}>
        {heading(false)}
        <div className={styles.state}>
          <span className={styles.stateIcon} style={{ background: 'var(--err-bg)' }}>
            <AlertCircleIcon size={40} strokeWidth={2} color="var(--err-fg)" />
          </span>
          <div className={styles.stateTitle}>{COPY.gap.loadFailed.title}</div>
          <p className={styles.stateText}>{COPY.gap.loadFailed.text}</p>
          <div className={styles.actionWrap}>
            <button type="button" className={styles.action} onClick={gallery.retry}>
              <RefreshIcon size={18} strokeWidth={2} />
              {COPY.gap.loadFailed.action}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const state = gallery.state;
  if (state.items.length === 0 && uploads.length === 0) {
    return (
      <div className={styles.page}>
        {heading(false)}
        <div className={styles.state}>
          <span className={styles.stateIcon} style={{ background: 'var(--pink)' }}>
            <ImageIcon size={36} strokeWidth={2} color="var(--rose)" />
          </span>
          <div className={styles.stateTitle}>{COPY.empty.title}</div>
          <p className={styles.stateText}>{COPY.empty.text}</p>
          <div className={styles.actionWrap}>
            <button type="button" className={styles.action} onClick={choose}>
              <UploadIcon size={20} strokeWidth={2} />
              {COPY.upload}
            </button>
          </div>
        </div>
        {picker}
        <BottomToast message={flash} bottom={100} />
      </div>
    );
  }

  const failed = uploads.find((u) => u.phase === 'failed');
  return (
    <div className={styles.page}>
      {heading(true)}
      <div className={styles.body}>
        {failed ? null : (
          <>
            <div className={styles.count}>{COPY.count(state.total)}</div>
            <div className={styles.note}>
              <LockIcon size={18} strokeWidth={2} />
              <span>{COPY.note}</span>
            </div>
          </>
        )}
        <div className={styles.gridWrap}>
          {failed ? (
            <div className={styles.banner} role="alert">
              <span className={styles.bannerIcon}>
                <AlertCircleIcon size={22} strokeWidth={2} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className={styles.bannerTitle}>{COPY.failedBanner.title}</div>
                <div className={styles.bannerText}>{bannerText(failed)}</div>
              </div>
            </div>
          ) : null}
          <div className={styles.grid}>
            {uploads.map((u) =>
              u.phase === 'failed' ? (
                <GalleryTile key={u.localId} state="failed" onRetry={() => retry(u.localId)} />
              ) : (
                <GalleryTile key={u.localId} state="uploading" progress={u.progress} />
              ),
            )}
            {state.items.map((item) => (
              <GalleryTile
                key={item.asset.id}
                state="ready"
                kind={item.asset.kind}
                thumbnailUrl={item.asset.thumbnail_url}
                durationSeconds={item.asset.duration_seconds}
                isNew={gallery.fresh.has(item.asset.id)}
                label={item.asset.kind === 'VIDEO' ? COPY.tile.video : COPY.tile.photo}
                onOpen={() => void navigate(`/gallery/${item.asset.id}`)}
                onThumbnailError={onThumbnailError}
              />
            ))}
          </div>
        </div>
      </div>
      {state.more === 'loading' ? <div className={styles.more}>{COPY.gap.loadingMore}</div> : null}
      {state.more === 'failed' ? (
        <div className={styles.more}>
          {COPY.gap.moreFailed}
          <button
            type="button"
            className={styles.moreButton}
            onClick={() => void gallery.loadMore()}
          >
            {COPY.gap.moreRetry}
          </button>
        </div>
      ) : null}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {picker}
      <BottomToast message={flash} bottom={100} />
    </div>
  );
}

/** `/gallery` and, over it, the viewer route `/gallery/:assetId` (the grid stays mounted underneath). */
export function GalleryPage(props: { api: MiniappApi; put?: PutFile; pollMs?: number }) {
  return (
    <>
      <GalleryScreen {...props} />
      <Outlet />
    </>
  );
}
