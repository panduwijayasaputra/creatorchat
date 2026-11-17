import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { AdminMediaDetail } from '@creatorchat/contracts';
import { Button, ChevronLeftIcon, LockIcon, formatDuration } from '@creatorchat/ui';
import { ApiError, type CreatorGalleryApi } from '../../../auth/api-client';
import { usePageCrumbs } from '../../../components/shell/page-crumbs';
import { GALLERY_COPY as C } from '../../copy';
import page from '../../../users/detail/user-detail.module.css';
import detail from '../creator-detail.module.css';
import { formatBytes, formatDateTimeWib } from '../../format';
import mine from './gallery.module.css';

type State =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; data: AdminMediaDetail };

/** `/creators/:id/gallery/:mediaId` (`AdmMediaDetail`): one gallery media, read-only. */
export function MediaDetailPage({ api }: { api: CreatorGalleryApi }) {
  const { id = '', mediaId = '' } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [previewBroken, setPreviewBroken] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setPreviewBroken(false);
    apiRef.current.getCreatorMedia(id, mediaId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not_found' }
            : { status: 'error' },
        );
      },
    );
    return () => controller.abort();
  }, [id, mediaId, attempt]);

  const data = state.status === 'ready' ? state.data : null;
  const galleryUrl = from ?? `/creators/${encodeURIComponent(id)}/gallery`;
  usePageCrumbs(
    data
      ? [
          { label: 'Dashboard', to: '/' },
          { label: 'Creator', to: '/creators' },
          { label: data.creator.display_name, to: `/creators/${encodeURIComponent(id)}` },
          { label: 'Galeri', to: galleryUrl },
          { label: C.number(data.number) },
        ]
      : null,
  );

  const back = (
    <Link to={galleryUrl} className={page.back}>
      <ChevronLeftIcon size={16} strokeWidth={2} />
      {C.detail.back}
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <>
        {back}
        <div className={detail.state} role="status">
          <p className={detail.stateText}>{C.gap.loading}</p>
        </div>
      </>
    );
  }
  if (state.status === 'not_found') {
    return (
      <>
        {back}
        <div className={detail.state}>
          <h2 className={detail.stateTitle}>{C.gap.notFound}</h2>
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        {back}
        <div className={detail.state} role="alert">
          <p className={detail.stateText}>{C.gap.loadFailed}</p>
          <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            {C.gap.retry}
          </Button>
        </div>
      </>
    );
  }

  const m = state.data;
  const rows: [string, string][] = [
    [C.detail.rows.kind, C.kind[m.kind]],
    [
      C.detail.rows.duration,
      m.duration_seconds === null ? '–' : formatDuration(m.duration_seconds),
    ],
    [C.detail.rows.size, formatBytes(m.size_bytes)],
    [C.detail.rows.uploaded, formatDateTimeWib(m.uploaded_at)],
    [C.detail.rows.creator, m.creator.display_name],
    [C.detail.rows.shownIn, C.detail.shownIn],
    [C.detail.rows.id, m.short_id],
  ];
  return (
    <>
      {back}
      <div className={mine.layout}>
        <div className={mine.preview}>
          {previewBroken ? (
            <span className={mine.previewText}>{C.gap.previewFailed}</span>
          ) : m.kind === 'PHOTO' ? (
            <img
              src={m.preview.url}
              alt={C.number(m.number)}
              onError={() => setPreviewBroken(true)}
            />
          ) : (
            <video
              src={m.preview.url}
              {...(m.poster_url ? { poster: m.poster_url } : {})}
              controls
              playsInline
              preload="metadata"
              onError={() => setPreviewBroken(true)}
            />
          )}
        </div>
        <div className={mine.info}>
          <h2 className={mine.infoTitle}>{C.detail.info}</h2>
          <dl style={{ margin: 0 }}>
            {rows.map(([label, value]) => (
              <div key={label} className={mine.infoRow}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={`${mine.noteBox} ${mine.infoNote}`}>
            <LockIcon size={18} strokeWidth={2} />
            <span>{C.detail.note}</span>
          </div>
        </div>
      </div>
    </>
  );
}
