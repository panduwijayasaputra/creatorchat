import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CREATOR_LIST_PAGE_SIZES,
  instagramHandle,
  type CreatorListQuery,
  type CreatorListRow,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  SearchInput,
  Select,
  SearchIcon,
  StatusChip,
  TableToolbar,
  ToastProvider,
  useToast,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { CreatorListApi, CreatorModerationApi, CreatorReviewApi } from '../auth/api-client';
import { ApproveRequestDialog } from './ApproveRequestDialog';
import {
  blockedToast,
  LIST_COPY,
  rejectedToast,
  statusConflictToast,
  unblockedToast,
} from './copy';
import { BlockCreatorDialog } from './BlockCreatorDialog';
import { UnblockCreatorDialog } from './UnblockCreatorDialog';
import { CreatorRowActions, type RowActionHandlers } from './CreatorRowActions';
import styles from './creators-page.module.css';
import { formatDateWib, initialsOf } from './format';
import {
  isDefaultFilter,
  listSearchParams,
  parseListSearch,
  resetFilters,
  STATUS_COMBINATIONS,
} from './list-url';
import { RejectRequestDialog } from './RejectRequestDialog';
import { paletteFor } from './RequestTarget';
import { useCreatorList } from './useCreatorList';
import { useLayoutMode, type LayoutMode } from './useLayoutMode';

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;
const STATUS_LABEL = { request: 'Request', active: 'Active', blocked: 'Blocked' } as const;
const SEARCH_DEBOUNCE_MS = 300;

const statusOptions = STATUS_COMBINATIONS.map((combo) => ({
  value: combo.join(','),
  label: combo.map((s) => STATUS_LABEL[s]).join(', '),
}));
const typeOptions = Object.entries(LIST_COPY.typeOptions).map(([value, label]) => ({
  value,
  label,
}));
const rangeOptions = Object.entries(LIST_COPY.dateOptions).map(([value, label]) => ({
  value,
  label,
}));

function IdentityCell({ row }: { row: CreatorListRow }) {
  const colour = paletteFor(row.id);
  return (
    <div className={styles.identity}>
      {row.avatar_url ? (
        <img
          className={styles.disc}
          src={row.avatar_url}
          alt=""
          referrerPolicy="no-referrer"
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span
          className={styles.disc}
          style={{ background: colour.bg, color: colour.fg }}
          aria-hidden="true"
        >
          {initialsOf(row.creator_name)}
        </span>
      )}
      <span className={styles.name}>{row.creator_name}</span>
    </div>
  );
}

function buildColumns(mode: LayoutMode, handlers: RowActionHandlers): Column<CreatorListRow>[] {
  const creator: Column<CreatorListRow> = {
    key: 'name',
    header: 'Creator',
    sortable: true,
    sticky: mode === 'mobile' ? undefined : 'start',
    ...(mode === 'desktop' ? {} : { width: '230px' }),
    render: (row) => <IdentityCell row={row} />,
  };
  const status: Column<CreatorListRow> = {
    key: 'status',
    header: 'Status',
    sortable: true,
    width: mode === 'desktop' ? '116px' : mode === 'tablet' ? '132px' : '120px',
    render: (row) => (
      <div>
        <StatusChip status={row.status.toLowerCase() as 'request' | 'active' | 'blocked'} />
        {row.status === 'REQUEST' && row.has_active_subscription ? (
          <div className={styles.caption}>{LIST_COPY.activeSubscription}</div>
        ) : null}
      </div>
    ),
  };
  const subscribers: Column<CreatorListRow> = {
    key: 'subscribers',
    header: 'Subscriber',
    sortable: true,
    width: mode === 'desktop' ? '108px' : '100px',
    render: (row) => (row.subscriber_count === null ? '–' : row.subscriber_count),
  };
  const actions: Column<CreatorListRow> = {
    key: 'actions',
    header: 'Aksi',
    sticky: mode === 'mobile' ? undefined : 'end',
    width: mode === 'desktop' ? '232px' : '220px',
    render: (row) => <CreatorRowActions row={row} handlers={handlers} />,
  };
  // Tablet and mobile boards show the same four columns; the frame scrolls sideways.
  if (mode !== 'desktop') return [creator, status, subscribers, actions];
  return [
    creator,
    {
      key: 'telegram',
      header: 'Telegram',
      sortable: true,
      width: '144px',
      render: (row) => (
        <div>
          <div>{row.telegram_username ? `@${row.telegram_username}` : '–'}</div>
          <div className={styles.sub}>ID {row.telegram_id}</div>
        </div>
      ),
    },
    {
      key: 'instagram',
      header: 'Instagram',
      width: '124px',
      render: (row) => (row.instagram_url ? instagramHandle(row.instagram_url) : '–'),
    },
    {
      key: 'type',
      header: 'Jenis',
      sortable: true,
      width: '104px',
      render: (row) => <span className={styles.nowrap}>{TYPE_LABEL[row.creator_type]}</span>,
    },
    status,
    subscribers,
    {
      key: 'date',
      header: 'Tanggal',
      sortable: true,
      width: '116px',
      render: (row) => <span className={styles.nowrap}>{formatDateWib(row.date)}</span>,
    },
    actions,
  ];
}

export interface CreatorsPageProps {
  api: CreatorListApi & CreatorReviewApi & CreatorModerationApi;
}

/**
 * `/creators` (`AdmCreators`, `AdmCreatorsTablet`, `AdmCreatorsMobile`, `AdmTableStates`). The server
 * does the searching, filtering, sorting and paging; this page only keeps the view in the URL.
 */
export function CreatorsPage(props: CreatorsPageProps) {
  return (
    <ToastProvider>
      <CreatorsList {...props} />
    </ToastProvider>
  );
}

function CreatorsList({ api }: CreatorsPageProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = useLayoutMode();
  const query = useMemo(() => parseListSearch(params), [params]);
  const { state, reload } = useCreatorList(api, query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toast = useToast();
  // The row a decision dialog belongs to. It is kept after closing so the dialog can fade out
  // and give the focus back to the button that opened it.
  const [decision, setDecision] = useState<{
    kind: 'approve' | 'reject' | 'block' | 'unblock';
    row: CreatorListRow;
    open: boolean;
  } | null>(null);
  const closeDecision = () => setDecision((d) => (d ? { ...d, open: false } : d));

  const update = useCallback(
    (next: CreatorListQuery, replace = false) => setParams(listSearchParams(next), { replace }),
    [setParams],
  );
  const change = (patch: Partial<CreatorListQuery>) => update({ ...query, ...patch, page: 1 });

  // The search box types freely; the URL (and the request) follow after a short pause.
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

  // A page past the end (rows were decided elsewhere) moves to the last page.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { items, total, page_size: size } = state.data;
    if (items.length === 0 && total > 0 && query.page > 1) {
      update({ ...query, page: Math.max(1, Math.ceil(total / size)) }, true);
    }
  }, [state, query, update]);

  const handlers: RowActionHandlers = {
    onView: (row) => void navigate(`/creators/${encodeURIComponent(row.id)}`),
    onApprove: (row) => setDecision({ kind: 'approve', row, open: true }),
    onReject: (row) => setDecision({ kind: 'reject', row, open: true }),
    onBlock: (row) => setDecision({ kind: 'block', row, open: true }),
    onUnblock: (row) => setDecision({ kind: 'unblock', row, open: true }),
  };
  const columns = buildColumns(mode, handlers);

  const reset = () => {
    setText('');
    update(resetFilters(query));
  };

  const controls = (
    <>
      <Select
        label="Status"
        value={query.status.join(',')}
        options={statusOptions}
        onChange={(value) => change({ status: value.split(',') as CreatorListQuery['status'] })}
      />
      <Select
        label="Jenis"
        value={query.type}
        options={typeOptions}
        onChange={(value) => change({ type: value as CreatorListQuery['type'] })}
      />
      <Select
        label="Tanggal"
        value={query.range}
        options={rangeOptions}
        onChange={(value) => change({ range: value as CreatorListQuery['range'] })}
      />
    </>
  );

  const searchBox = (placeholder: string, className?: string) => (
    <SearchInput
      aria-label={LIST_COPY.search}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      {...(className ? { className } : {})}
    />
  );

  const toolbar =
    mode === 'mobile' ? (
      <>
        <div className={styles.panel}>
          {searchBox(LIST_COPY.searchMobile)}
          <Button
            variant="outline"
            className={styles.filterButton}
            icon={<SearchIcon size={16} strokeWidth={2} />}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {LIST_COPY.filterMobile}
          </Button>
        </div>
        {filtersOpen ? (
          <div className={styles.panel} role="group" aria-label={LIST_COPY.filterMobile}>
            {controls}
            <Button variant="outline" onClick={reset}>
              Reset Filter
            </Button>
          </div>
        ) : null}
      </>
    ) : (
      <TableToolbar onReset={reset}>
        {searchBox(LIST_COPY.search, styles.search)}
        {mode === 'desktop' ? (
          controls
        ) : (
          <Select
            label="Status"
            value={query.status.join(',')}
            options={statusOptions}
            onChange={(value) => change({ status: value.split(',') as CreatorListQuery['status'] })}
          />
        )}
      </TableToolbar>
    );

  const sort: SortState = { key: query.sort, direction: query.dir };
  const rows = state.status === 'ready' ? state.data.items : [];

  return (
    <div className={styles.page}>
      {mode === 'desktop' ? <p className={styles.intro}>{LIST_COPY.intro}</p> : null}
      <DataTable<CreatorListRow>
        bare
        dense
        label="Creator"
        columns={columns}
        rows={rows}
        status={state.status}
        rowKey={(row) => `${row.kind}:${row.id}`}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as CreatorListQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultFilter(query)}
        onResetFilters={reset}
        onRetry={reload}
        toolbar={toolbar}
        minWidth={mode === 'desktop' ? 1090 : 680}
        pagination={{
          page: query.page,
          pageSize: query.page_size,
          total: state.status === 'ready' ? state.data.total : 0,
          onPageChange: (page) => update({ ...query, page }),
          onPageSizeChange: (size) =>
            update({
              ...query,
              page_size: (CREATOR_LIST_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as CreatorListQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
      {mode !== 'desktop' ? <p className={styles.hint}>{LIST_COPY.scrollHint}</p> : null}
      {decision ? (
        <>
          <ApproveRequestDialog
            requestId={decision.row.id}
            open={decision.open && decision.kind === 'approve'}
            api={api}
            onClose={closeDecision}
            onDecided={() => {
              // Approved, or somebody else decided first: either way the server's row is the truth.
              closeDecision();
              reload();
            }}
          />
          <RejectRequestDialog
            requestId={decision.row.id}
            open={decision.open && decision.kind === 'reject'}
            api={api}
            onClose={closeDecision}
            onDecided={(result) => {
              closeDecision();
              if (result.kind === 'rejected') {
                toast.show({ message: rejectedToast(result.response.request.creator_name) });
              }
              reload();
            }}
          />
          <BlockCreatorDialog
            row={decision.row}
            open={decision.open && decision.kind === 'block'}
            api={api}
            onClose={closeDecision}
            onDecided={(result) => {
              closeDecision();
              toast.show({
                message:
                  result.kind === 'blocked'
                    ? blockedToast(decision.row.creator_name)
                    : statusConflictToast(decision.row.creator_name),
              });
              reload();
            }}
          />
          <UnblockCreatorDialog
            row={decision.row}
            open={decision.open && decision.kind === 'unblock'}
            api={api}
            onClose={closeDecision}
            onDecided={(result) => {
              closeDecision();
              toast.show({
                message:
                  result.kind === 'unblocked'
                    ? unblockedToast(decision.row.creator_name)
                    : statusConflictToast(decision.row.creator_name),
              });
              reload();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
