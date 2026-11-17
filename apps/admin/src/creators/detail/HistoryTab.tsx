import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  HISTORY_PAGE_SIZES,
  type HistoryQuery,
  type HistoryResponse,
  type HistoryRow,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  SearchInput,
  Select,
  StatusChip,
  TableToolbar,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import { HISTORY_COPY } from '../copy';
import styles from '../creators-page.module.css';
import { formatClockWib, formatDateWib } from '../format';
import {
  historySearchParams,
  isDefaultHistoryFilter,
  parseHistorySearch,
  resetHistoryFilters,
} from './history-url';

const SEARCH_DEBOUNCE_MS = 300;
const options = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));
const typeOptions = options(HISTORY_COPY.typeOptions);
const statusOptions = options(HISTORY_COPY.statusOptions);

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: HistoryResponse };

export interface HistoryTabProps {
  /** Loads one page for the person; shared by the creator and the user pages. */
  load: (query: HistoryQuery, signal: AbortSignal) => Promise<HistoryResponse>;
  /** Router state for the Detail Log back link. */
  backState: { from: string; label: string };
}

const time = (iso: string) => `${formatDateWib(iso)}, ${formatClockWib(iso)}`;

/** `AdmCrHistory` / `AdmUserHistory`: the audit rows about one person, filtered and paged by the server. */
export function HistoryTab({ load, backState }: HistoryTabProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHistorySearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadRef.current(query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [key, attempt]);

  const update = useCallback(
    (next: HistoryQuery, replace = false) => setParams(historySearchParams(next), { replace }),
    [setParams],
  );
  const change = (patch: Partial<HistoryQuery>) => update({ ...query, ...patch, page: 1 });

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
    update(resetHistoryFilters(query));
  };

  const columns: Column<HistoryRow>[] = [
    {
      key: 'time',
      header: 'Waktu',
      sortable: true,
      width: '160px',
      render: (row) => <span className={styles.nowrap}>{time(row.at)}</span>,
    },
    { key: 'actor', header: 'Aktor', sortable: true, width: '160px', render: (row) => row.actor },
    {
      key: 'action',
      header: 'Tindakan',
      sortable: true,
      width: '170px',
      render: (row) => row.action,
    },
    { key: 'summary', header: 'Ringkasan', render: (row) => row.summary || '–' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '124px',
      render: (row) => <StatusChip status={row.status} />,
    },
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
          aria-label={`View ${row.action}`}
          onClick={() => void navigate(`/logs/${encodeURIComponent(row.id)}`, { state: backState })}
        >
          View
        </Button>
      ),
    },
  ];

  const sort: SortState = { key: query.sort, direction: query.dir };
  return (
    <DataTable<HistoryRow>
      bare
      dense
      label="History"
      columns={columns}
      rows={state.status === 'ready' ? state.data.items : []}
      status={state.status}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={(next) =>
        update({ ...query, sort: next.key as HistoryQuery['sort'], dir: next.direction, page: 1 })
      }
      hasActiveFilters={!isDefaultHistoryFilter(query)}
      onResetFilters={reset}
      onRetry={() => setAttempt((n) => n + 1)}
      toolbar={
        <TableToolbar onReset={reset}>
          <SearchInput
            aria-label={HISTORY_COPY.search}
            placeholder={HISTORY_COPY.search}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={styles.search}
          />
          <Select
            label="Jenis"
            value={query.type}
            options={typeOptions}
            onChange={(value) => change({ type: value as HistoryQuery['type'] })}
          />
          <Select
            label="Status"
            value={query.status}
            options={statusOptions}
            onChange={(value) => change({ status: value as HistoryQuery['status'] })}
          />
        </TableToolbar>
      }
      minWidth={900}
      pagination={{
        page: query.page,
        pageSize: query.page_size,
        total: state.status === 'ready' ? state.data.total : 0,
        onPageChange: (page) => update({ ...query, page }),
        onPageSizeChange: (size) =>
          update({
            ...query,
            page_size: (HISTORY_PAGE_SIZES as readonly number[]).includes(size)
              ? (size as HistoryQuery['page_size'])
              : 10,
            page: 1,
          }),
      }}
    />
  );
}
