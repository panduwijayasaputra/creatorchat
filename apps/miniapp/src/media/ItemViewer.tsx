import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime, zoneLabel } from '../format/date-time';
import { useBackButton } from '../telegram/useBackButton';
import { MediaViewer } from './MediaViewer';
import styles from './media-viewer.module.css';

/** What a gallery viewer needs of one item, whoever it is shown to. */
export interface ViewerItem {
  kind: 'PHOTO' | 'VIDEO';
  durationSeconds: number | null;
  /** The short-lived signed file link. */
  url: string;
  uploadedAt: string;
  position: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
  /** Replaces the default "Diunggah …" footer (the chat viewer shows the message instead). */
  footer?: ReactNode;
}

/** design gap: no board for a viewer that cannot load */
const COPY = {
  failed: 'Media belum termuat.',
  notFound: 'Media tidak ditemukan.',
  retry: 'Coba Lagi',
  close: 'Tutup',
} as const;

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not-found' }
  | { status: 'ready'; item: ViewerItem; broken: boolean };

export interface ItemViewerProps {
  /** Fetches one item (a fresh signed link every time). */
  load: (assetId: string) => Promise<ViewerItem>;
  /** The route of another item. */
  pathFor: (assetId: string) => string;
  /** Where Tutup goes when the viewer was opened directly (nothing to go back to). */
  closeTo: string;
  /** The route parameter that holds the item's id (default `assetId`). */
  paramName?: string;
  /** Footer line start, e.g. "Salsa · Diunggah" is built as `${prefix}Diunggah ${when}`. */
  footerPrefix?: string;
  /** The server says access is gone (403 GALLERY_ACCESS_REQUIRED): the viewer closes itself. */
  onAccessLost?: () => void;
}

/**
 * The route screen behind every media viewer (`/gallery/:assetId`, `/creators/:code/gallery/:assetId`):
 * loads the item, shows `MediaViewer`, moves between neighbours by replacing the route and refreshes
 * a failing link once. Links live only in this component's state.
 */
export function ItemViewer({
  load,
  pathFor,
  closeTo,
  paramName = 'assetId',
  footerPrefix = '',
  onAccessLost,
}: ItemViewerProps) {
  const params = useParams();
  const assetId = params[paramName] ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const { state: auth } = useAuth();
  const timeZone = auth.status === 'authenticated' ? auth.user.timezone : 'Asia/Jakarta';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  /** A link that fails is refreshed once per item; a second failure shows the error. */
  const refreshedFor = useRef<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lostRef = useRef(onAccessLost);
  lostRef.current = onAccessLost;

  const close = useCallback(() => {
    // `key` is "default" for the first entry of the history: nothing to go back to.
    if (location.key !== 'default') void navigate(-1);
    else void navigate(closeTo, { replace: true });
  }, [closeTo, location.key, navigate]);
  const closeRef = useRef(close);
  closeRef.current = close;

  const fetchItem = useCallback(
    async (keepVisible: boolean) => {
      const mine = ++generation.current;
      if (!keepVisible) setState({ status: 'loading' });
      try {
        const item = await loadRef.current(assetId);
        if (generation.current === mine) setState({ status: 'ready', item, broken: false });
      } catch (error) {
        if (generation.current !== mine) return;
        if (error instanceof ApiError && error.code === 'GALLERY_ACCESS_REQUIRED') {
          lostRef.current?.();
          closeRef.current();
          return;
        }
        setState({
          status: error instanceof ApiError && error.status === 404 ? 'not-found' : 'error',
        });
      }
    },
    [assetId],
  );

  useEffect(() => {
    refreshedFor.current = null;
    void fetchItem(false);
    return () => {
      generation.current += 1;
    };
  }, [fetchItem, attempt]);

  useBackButton(close);

  const onMediaError = useCallback(() => {
    if (refreshedFor.current !== assetId) {
      refreshedFor.current = assetId;
      void fetchItem(true);
    } else {
      setState((s) => (s.status === 'ready' ? { ...s, broken: true } : s));
    }
  }, [assetId, fetchItem]);

  const go = (id: string | null) =>
    id ? () => void navigate(pathFor(id), { replace: true }) : undefined;

  if (state.status !== 'ready') {
    return (
      <MediaViewer kind="PHOTO" src={null} positionLabel="" onClose={close}>
        {state.status === 'loading' ? (
          <div role="status" aria-label="Memuat" />
        ) : (
          <div className={styles.panel}>
            <p className={styles.panelText}>
              {state.status === 'not-found' ? COPY.notFound : COPY.failed}
            </p>
            <button
              type="button"
              className={styles.panelButton}
              onClick={state.status === 'error' ? () => setAttempt((n) => n + 1) : close}
            >
              {state.status === 'error' ? COPY.retry : COPY.close}
            </button>
          </div>
        )}
      </MediaViewer>
    );
  }

  const { item, broken } = state;
  const when = `${formatDateTime(item.uploadedAt, timeZone, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} ${zoneLabel(timeZone)}`;
  return (
    <MediaViewer
      kind={item.kind}
      src={broken ? null : item.url}
      positionLabel={`${item.position} / ${item.total}`}
      durationSeconds={item.durationSeconds}
      onClose={close}
      onPrevious={go(item.previousId)}
      onNext={go(item.nextId)}
      onMediaError={onMediaError}
      footer={item.footer ?? `${footerPrefix}Diunggah ${when}`}
    >
      <div className={styles.panel}>
        <p className={styles.panelText}>{COPY.failed}</p>
        <button
          type="button"
          className={styles.panelButton}
          onClick={() => {
            refreshedFor.current = null;
            void fetchItem(true);
          }}
        >
          {COPY.retry}
        </button>
      </div>
    </MediaViewer>
  );
}
