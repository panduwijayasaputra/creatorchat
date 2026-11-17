import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ADMIN_GALLERY_PAGE_SIZES,
  type AdminGalleryQuery,
  type AdminGalleryResponse,
  type AdminGalleryRow,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  LockIcon,
  SearchInput,
  Select,
  TableToolbar,
  formatDuration,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { CreatorGalleryApi } from '../../../auth/api-client';
import { GALLERY_COPY as C } from '../../copy';
import styles from '../../creators-page.module.css';
import { formatBytes, formatDateWib } from '../../format';
import {
  gallerySearchParams,
  isDefaultGalleryFilter,
  parseGallerySearch,
  resetGalleryFilters,
} from './gallery-url';
import mine from './gallery.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const toOptions = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));
const kindOptions = toOptions(C.kindOptions);
const uploadedOptions = toOptions(C.uploadedOptions);

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AdminGalleryResponse };

function ThumbCell({ row }: { row: AdminGalleryRow }) {
  return (
    <div className={mine.thumbCell}>
      <div className={mine.thumb}>
        <img src={row.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        {row.kind === 'VIDEO' && row.duration_seconds !== null ? (
          <span className={mine.badge}>{formatDuration(row.duration_seconds)}</span>
        ) : null}
      </div>
      <span className={mine.number}>{C.number(row.number)}</span>
    </div>
  );
}

/**
 * The creator's Galeri tab (`AdmCrGallery`): gallery media filtered, sorted and paged by the server,
 * read-only. Search is by media number. The query lives in the URL, so a View and the way back keep it.
 */
export function GalleryTab({ api, creatorId }: { api: CreatorGalleryApi; creatorId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseGallerySearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRef.current.listCreatorGallery(creatorId, query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [creatorId, key, attempt]);

  const update = useCallback(
    (next: AdminGalleryQuery, replace = false) => setParams(gallerySearchParams(next), { replace }),
    [setParams],
  );

  const [text, setText] = useState(query.q ?? '');
  useEffect(() => setText(query.q ?? ''), [query.q]);
  useEffect(() => {
    if (text.trim() === (query.q ?? '')) return;
    const timer = setTimeout(
      () => update({ ...query, q: text.trim() || null, page: 1 }, true),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [text, query, update]);

  // A page past the end (the last item moved away): go to the real last page.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { items, total, page_size: size } = state.data;
    if (items.length === 0 && total > 0 && query.page > 1) {
      update({ ...query, page: Math.max(1, Math.ceil(total / size)) }, true);
    }
  }, [state, query, update]);

  const reset = () => {
    setText('');
    update(resetGalleryFilters(query));
  };

  const columns: Column<AdminGalleryRow>[] = [
    {
      key: 'number',
      header: C.columns.thumbnail,
      sortable: true,
      render: (r) => <ThumbCell row={r} />,
    },
    {
      key: 'kind',
      header: C.columns.kind,
      sortable: true,
      width: '100px',
      render: (r) => C.kind[r.kind],
    },
    {
      key: 'duration',
      header: C.columns.duration,
      sortable: true,
      width: '100px',
      render: (r) => (r.duration_seconds === null ? '–' : formatDuration(r.duration_seconds)),
    },
    {
      key: 'size',
      header: C.columns.size,
      sortable: true,
      width: '110px',
      render: (r) => formatBytes(r.size_bytes),
    },
    {
      key: 'uploaded',
      header: C.columns.uploaded,
      sortable: true,
      width: '140px',
      render: (r) => <span className={styles.nowrap}>{formatDateWib(r.uploaded_at)}</span>,
    },
    {
      key: 'actions',
      header: C.columns.actions,
      width: '110px',
      render: (r) => (
        <Button
          size="table"
          variant="outline"
          className={styles.compact}
          icon={<EyeIcon size={16} strokeWidth={2} />}
          aria-label={`View ${C.number(r.number)}`}
          onClick={() =>
            void navigate(`/creators/${encodeURIComponent(creatorId)}/gallery/${r.asset_id}`, {
              state: { from: `${location.pathname}${location.search}` },
            })
          }
        >
          View
        </Button>
      ),
    },
  ];

  const sort: SortState = {
    key: query.sort === 'number' ? 'number' : query.sort,
    direction: query.dir,
  };
  return (
    <>
      <div className={mine.noteBox}>
        <LockIcon size={18} strokeWidth={2} />
        <span>{C.note}</span>
      </div>
      <DataTable<AdminGalleryRow>
        bare
        dense
        label="Galeri"
        columns={columns}
        rows={state.status === 'ready' ? state.data.items : []}
        status={state.status}
        rowKey={(r) => r.asset_id}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as AdminGalleryQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultGalleryFilter(query)}
        onResetFilters={reset}
        onRetry={() => setAttempt((n) => n + 1)}
        toolbar={
          <TableToolbar onReset={reset}>
            <SearchInput
              aria-label={C.search}
              placeholder={C.search}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={styles.search}
            />
            <Select
              label={C.kindLabel}
              value={query.kind}
              options={kindOptions}
              onChange={(value) =>
                update({ ...query, kind: value as AdminGalleryQuery['kind'], page: 1 })
              }
            />
            <Select
              label={C.uploadedLabel}
              value={query.uploaded}
              options={uploadedOptions}
              onChange={(value) =>
                update({ ...query, uploaded: value as AdminGalleryQuery['uploaded'], page: 1 })
              }
            />
          </TableToolbar>
        }
        minWidth={1000}
        pagination={{
          page: query.page,
          pageSize: query.page_size,
          total: state.status === 'ready' ? state.data.total : 0,
          onPageChange: (p) => update({ ...query, page: p }),
          onPageSizeChange: (size) =>
            update({
              ...query,
              page_size: (ADMIN_GALLERY_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as AdminGalleryQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
    </>
  );
}
