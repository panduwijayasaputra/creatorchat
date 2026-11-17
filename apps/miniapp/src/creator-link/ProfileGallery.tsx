import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { GalleryTile } from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { PROFILE_COPY as C } from './profile-copy';
import { useCustomerGallery } from './useCustomerGallery';
import styles from './profile.module.css';

/**
 * The Galeri section of an ACTIVE profile (`CreatorActive`): the creator's tiles, opened in the
 * viewer. Only mounted when the profile says ACTIVE, so no other state ever requests the gallery.
 */
export function ProfileGallery({
  api,
  publicCode,
  onAccessLost,
}: {
  api: Pick<MiniappApi, 'getCustomerGallery'>;
  publicCode: string;
  onAccessLost: () => void;
}) {
  const navigate = useNavigate();
  const { state, loadMore, retry } = useCustomerGallery(api, publicCode, onAccessLost);

  const sentinel = useRef<HTMLDivElement>(null);
  const canLoadMore =
    state.status === 'ready' && state.nextCursor !== null && state.more === 'idle';
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, loadMore]);

  if (state.status === 'loading') {
    return (
      <div className={styles.tiles} role="status" aria-label="Memuat" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden="true" className={styles.tileSkeleton} />
        ))}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <p className={styles.placeholder}>
        {C.gap.galleryFailed}
        <button type="button" className={styles.inlineAction} onClick={retry}>
          {C.gap.galleryRetry}
        </button>
      </p>
    );
  }
  if (state.items.length === 0) return <p className={styles.placeholder}>{C.gap.galleryEmpty}</p>;
  return (
    <>
      <div className={styles.tiles}>
        {state.items.map((item) => (
          <GalleryTile
            key={item.id}
            state="ready"
            kind={item.kind}
            thumbnailUrl={item.thumbnail_url}
            durationSeconds={item.duration_seconds}
            aspect="portrait"
            label={item.kind === 'VIDEO' ? C.tile.video : C.tile.photo}
            onOpen={() => void navigate(`/creators/${publicCode}/gallery/${item.id}`)}
          />
        ))}
      </div>
      {state.more === 'failed' ? (
        <p className={styles.placeholder}>
          {C.gap.galleryMoreFailed}
          <button type="button" className={styles.inlineAction} onClick={() => void loadMore()}>
            {C.gap.galleryRetry}
          </button>
        </p>
      ) : null}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
    </>
  );
}
