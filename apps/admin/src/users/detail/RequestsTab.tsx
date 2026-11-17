import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  USER_REQUEST_PAGE_SIZES,
  type UserRequestRow,
  type UserRequestsQuery,
  type UserRequestsResponse,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  HourglassIcon,
  SearchInput,
  Select,
  StatusChip,
  TableToolbar,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { UserDetailApi } from '../../auth/api-client';
import styles from '../../creators/creators-page.module.css';
import { formatClockWib, formatDateWib } from '../../creators/format';
import { USER_DETAIL_COPY as C } from '../copy';
import {
  isDefaultRequestsFilter,
  parseRequestsSearch,
  requestsSearchParams,
  resetRequestsFilters,
} from './requests-url';
import page from './user-detail.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const statusOptions = Object.entries(C.requests.statusOptions).map(([value, label]) => ({
  value,
  label,
}));

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: UserRequestsResponse };

const time = (iso: string) => `${formatDateWib(iso)}, ${formatClockWib(iso)}`;

/** `AdmUserRequest`: the user's creator requests, filtered and paged by the server. */
export function RequestsTab({
  api,
  userId,
}: {
  api: Pick<UserDetailApi, 'listUserRequests'>;
  userId: string;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseRequestsSearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRef.current.listUserRequests(userId, query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [userId, key, attempt]);

  const update = useCallback(
    (next: UserRequestsQuery, replace = false) =>
      setParams(requestsSearchParams(next), { replace }),
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

  useEffect(() => {
    if (state.status !== 'ready') return;
    const { items, total, page_size: size } = state.data;
    if (items.length === 0 && total > 0 && query.page > 1) {
      update({ ...query, page: Math.max(1, Math.ceil(total / size)) }, true);
    }
  }, [state, query, update]);

  const reset = () => {
    setText('');
    update(resetRequestsFilters(query));
  };

  const columns: Column<UserRequestRow>[] = [
    {
      key: 'date',
      header: C.requests.columns.date,
      sortable: true,
      width: '170px',
      render: (row) => <span className={styles.nowrap}>{time(row.created_at)}</span>,
    },
    {
      key: 'ordinal',
      header: C.requests.columns.ordinal,
      width: '140px',
      render: (row) => `Pengajuan ke-${row.ordinal}`,
    },
    {
      key: 'status',
      header: C.requests.columns.status,
      sortable: true,
      width: '124px',
      render: (row) => <StatusChip status={row.status === 'PENDING' ? 'pending' : 'rejected'} />,
    },
    { key: 'summary', header: C.requests.columns.summary, render: (row) => row.summary },
    {
      key: 'actions',
      header: 'Aksi',
      width: '100px',
      render: (row) => (
        <Button
          size="table"
          variant="outline"
          className={styles.compact}
          icon={<EyeIcon size={16} strokeWidth={2} />}
          aria-label={`View pengajuan ke-${row.ordinal}`}
          onClick={() =>
            void navigate(
              `/users/${encodeURIComponent(userId)}/requests/${encodeURIComponent(row.id)}`,
            )
          }
        >
          View
        </Button>
      ),
    },
  ];

  const pending = state.status === 'ready' ? state.data.pending : null;
  const sort: SortState = { key: query.sort, direction: query.dir };
  return (
    <>
      {pending ? (
        <div className={`${page.banner} ${page.bannerPending}`} role="status">
          <span className={page.bannerIcon} style={{ background: '#fbedd0' }}>
            <HourglassIcon size={20} strokeWidth={2} />
          </span>
          <div>
            <div className={page.bannerTitle}>{C.requests.bannerTitle}</div>
            <div className={page.bannerText}>
              {pending.subscription_block
                ? `Tidak bisa disetujui sekarang: akun ini punya ${pending.subscription_block.count} langganan pelanggan aktif (${pending.subscription_block.creator_name}, hingga ${formatDateWib(pending.subscription_block.ends_at)}).`
                : C.gap.bannerNoBlock}
            </div>
          </div>
        </div>
      ) : null}
      <DataTable<UserRequestRow>
        bare
        dense
        label="Pengajuan creator"
        columns={columns}
        rows={state.status === 'ready' ? state.data.items : []}
        status={state.status}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as UserRequestsQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultRequestsFilter(query)}
        onResetFilters={reset}
        onRetry={() => setAttempt((n) => n + 1)}
        toolbar={
          <TableToolbar onReset={reset}>
            <SearchInput
              aria-label={C.requests.search}
              placeholder={C.requests.search}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={styles.search}
            />
            <Select
              label="Status"
              value={query.status}
              options={statusOptions}
              onChange={(value) =>
                update({ ...query, status: value as UserRequestsQuery['status'], page: 1 })
              }
            />
          </TableToolbar>
        }
        minWidth={820}
        pagination={{
          page: query.page,
          pageSize: query.page_size,
          total: state.status === 'ready' ? state.data.total : 0,
          onPageChange: (p) => update({ ...query, page: p }),
          onPageSizeChange: (size) =>
            update({
              ...query,
              page_size: (USER_REQUEST_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as UserRequestsQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
    </>
  );
}
