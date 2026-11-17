import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { USER_LIST_PAGE_SIZES, type UserListQuery, type UserListRow } from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  HourglassIcon,
  RefreshIcon,
  SearchIcon,
  SearchInput,
  Select,
  StatusChip,
  TableToolbar,
  ToastProvider,
  UserSlashIcon,
  useToast,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { UserListApi, UserModerationApi } from '../auth/api-client';
import styles from '../creators/creators-page.module.css';
import { formatDateWib, initialsOf } from '../creators/format';
import { paletteFor } from '../creators/RequestTarget';
import { useLayoutMode, type LayoutMode } from '../creators/useLayoutMode';
import { BlockUserDialog } from './BlockUserDialog';
import {
  ACCESS_REQUEST_COPY as ACCESS,
  USER_LIST_COPY as COPY,
  userBlockedToast,
  userConflictToast,
  userUnblockedToast,
} from './copy';
import {
  isDefaultUserFilter,
  parseUserListSearch,
  resetUserFilters,
  userListSearchParams,
} from './list-url';
import { UnblockUserDialog } from './UnblockUserDialog';
import { useUserList } from './useUserList';
import mine from './users.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const options = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));
const statusOptions = options(COPY.statusOptions);
const requestOptions = options(COPY.requestOptions);
const joinedOptions = options(COPY.joinedOptions);
const accessOptions = options(ACCESS.filterOptions);
const REQUEST_CHIP = { NONE: 'none', PENDING: 'pending', REJECTED: 'rejected' } as const;

function IdentityCell({ row }: { row: UserListRow }) {
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
          {initialsOf(row.display_name)}
        </span>
      )}
      <span className={styles.name}>{row.display_name}</span>
      {row.pending_access_count > 0 ? (
        <span className={mine.accessChip}>
          <HourglassIcon size={13} strokeWidth={2} aria-hidden="true" />
          {ACCESS.chip}
          {row.pending_access_count > 1 ? ` (${row.pending_access_count})` : ''}
        </span>
      ) : null}
    </div>
  );
}

interface UserRowHandlers {
  onView: (row: UserListRow) => void;
  onBlock: (row: UserListRow) => void;
  onUnblock: (row: UserListRow) => void;
}

/** The Aksi cell: View, plus Block for an Active user and Unblock for a Blocked one. */
function UserRowActions({ row, handlers }: { row: UserListRow; handlers: UserRowHandlers }) {
  return (
    <div className={styles.actions}>
      <Button
        size="table"
        variant="outline"
        className={styles.compact}
        icon={<EyeIcon size={16} strokeWidth={2} />}
        aria-label={`View ${row.display_name}`}
        onClick={() => handlers.onView(row)}
      >
        View
      </Button>
      {row.status === 'ACTIVE' ? (
        <Button
          size="table"
          variant="danger"
          className={styles.compact}
          icon={<UserSlashIcon size={15} strokeWidth={2} />}
          aria-label={`Block ${row.display_name}`}
          onClick={() => handlers.onBlock(row)}
        >
          Block
        </Button>
      ) : (
        <Button
          size="table"
          variant="outline"
          className={styles.compact}
          icon={<RefreshIcon size={15} strokeWidth={2} />}
          aria-label={`Unblock ${row.display_name}`}
          onClick={() => handlers.onUnblock(row)}
        >
          Unblock
        </Button>
      )}
    </div>
  );
}

function buildColumns(mode: LayoutMode, handlers: UserRowHandlers): Column<UserListRow>[] {
  const user: Column<UserListRow> = {
    key: 'name',
    header: 'Pengguna',
    sortable: true,
    sticky: mode === 'mobile' ? undefined : 'start',
    ...(mode === 'desktop' ? {} : { width: '230px' }),
    render: (row) => <IdentityCell row={row} />,
  };
  const status: Column<UserListRow> = {
    key: 'status',
    header: 'Status',
    sortable: true,
    width: '116px',
    render: (row) => <StatusChip status={row.status === 'ACTIVE' ? 'active' : 'blocked'} />,
  };
  const request: Column<UserListRow> = {
    key: 'request',
    header: 'Pengajuan creator',
    sortable: true,
    width: '176px',
    render: (row) => <StatusChip status={REQUEST_CHIP[row.creator_request_status]} />,
  };
  const actions: Column<UserListRow> = {
    key: 'actions',
    header: 'Aksi',
    sticky: mode === 'mobile' ? undefined : 'end',
    width: '220px',
    render: (row) => <UserRowActions row={row} handlers={handlers} />,
  };
  // No tablet / mobile boards: the same compact column set as the creator list (design gap).
  if (mode !== 'desktop') return [user, status, request, actions];
  return [
    user,
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
    status,
    {
      key: 'subscriptions',
      header: 'Langganan aktif',
      sortable: true,
      width: '140px',
      render: (row) => row.active_subscription_count,
    },
    request,
    {
      key: 'date',
      header: 'Bergabung',
      sortable: true,
      width: '116px',
      render: (row) => <span className={styles.nowrap}>{formatDateWib(row.joined_at)}</span>,
    },
    actions,
  ];
}

export interface UsersPageProps {
  api: UserListApi & UserModerationApi;
}

/**
 * `/users` (`AdmUsers`, `AdmTableStates`). The server does the searching, filtering, sorting and
 * paging; this page only keeps the view in the URL.
 */
export function UsersPage(props: UsersPageProps) {
  return (
    <ToastProvider>
      <UsersList {...props} />
    </ToastProvider>
  );
}

function UsersList({ api }: UsersPageProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode = useLayoutMode();
  const query = useMemo(() => parseUserListSearch(params), [params]);
  const { state, reload } = useUserList(api, query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toast = useToast();
  // The row a decision dialog belongs to; kept after closing so the dialog can give the focus back.
  const [decision, setDecision] = useState<{
    kind: 'block' | 'unblock';
    row: UserListRow;
    open: boolean;
  } | null>(null);
  const closeDecision = () => setDecision((d) => (d ? { ...d, open: false } : d));

  const update = useCallback(
    (next: UserListQuery, replace = false) => setParams(userListSearchParams(next), { replace }),
    [setParams],
  );
  const change = (patch: Partial<UserListQuery>) => update({ ...query, ...patch, page: 1 });

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

  // A page past the end moves to the last page.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { items, total, page_size: size } = state.data;
    if (items.length === 0 && total > 0 && query.page > 1) {
      update({ ...query, page: Math.max(1, Math.ceil(total / size)) }, true);
    }
  }, [state, query, update]);

  const columns = buildColumns(mode, {
    onView: (row) => void navigate(`/users/${encodeURIComponent(row.id)}`),
    onBlock: (row) => setDecision({ kind: 'block', row, open: true }),
    onUnblock: (row) => setDecision({ kind: 'unblock', row, open: true }),
  });
  const reset = () => {
    setText('');
    update(resetUserFilters(query));
  };

  const controls = (
    <>
      <Select
        label="Status akun"
        value={query.status.length === 1 ? (query.status[0] as string) : 'all'}
        options={statusOptions}
        onChange={(value) =>
          change({ status: value === 'all' ? ['active', 'blocked'] : [value as 'active'] })
        }
      />
      <Select
        label="Pengajuan creator"
        value={query.request.length === 1 ? (query.request[0] as string) : 'all'}
        options={requestOptions}
        onChange={(value) =>
          change({
            request: value === 'all' ? ['none', 'pending', 'rejected'] : [value as 'none'],
          })
        }
      />
      <Select
        label={ACCESS.filterLabel}
        value={query.access}
        options={accessOptions}
        onChange={(value) => change({ access: value as UserListQuery['access'] })}
      />
      <Select
        label="Bergabung"
        value={query.range}
        options={joinedOptions}
        onChange={(value) => change({ range: value as UserListQuery['range'] })}
      />
    </>
  );

  const searchBox = (placeholder: string, className?: string) => (
    <SearchInput
      aria-label={COPY.search}
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
          {searchBox(COPY.searchMobile)}
          <Button
            variant="outline"
            className={styles.filterButton}
            icon={<SearchIcon size={16} strokeWidth={2} />}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {COPY.filterMobile}
          </Button>
        </div>
        {filtersOpen ? (
          <div className={styles.panel} role="group" aria-label={COPY.filterMobile}>
            {controls}
            <Button variant="outline" onClick={reset}>
              Reset Filter
            </Button>
          </div>
        ) : null}
      </>
    ) : (
      <TableToolbar onReset={reset}>
        {searchBox(COPY.search, mine.search)}
        {controls}
      </TableToolbar>
    );

  const sort: SortState = { key: query.sort, direction: query.dir };

  return (
    <div className={styles.page}>
      {mode === 'desktop' ? <p className={styles.intro}>{COPY.intro}</p> : null}
      <DataTable<UserListRow>
        bare
        dense
        label="Pengguna"
        columns={columns}
        rows={state.status === 'ready' ? state.data.items : []}
        status={state.status}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as UserListQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultUserFilter(query)}
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
              page_size: (USER_LIST_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as UserListQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
      {mode !== 'desktop' ? <p className={styles.hint}>{COPY.scrollHint}</p> : null}
      {decision ? (
        <>
          <BlockUserDialog
            row={decision.row}
            open={decision.open && decision.kind === 'block'}
            api={api}
            onClose={closeDecision}
            onDecided={(result) => {
              closeDecision();
              toast.show({
                message:
                  result.kind === 'blocked'
                    ? userBlockedToast(decision.row.display_name)
                    : userConflictToast(decision.row.display_name),
              });
              reload();
            }}
          />
          <UnblockUserDialog
            row={decision.row}
            open={decision.open && decision.kind === 'unblock'}
            api={api}
            onClose={closeDecision}
            onDecided={(result) => {
              closeDecision();
              toast.show({
                message:
                  result.kind === 'unblocked'
                    ? userUnblockedToast(decision.row.display_name)
                    : userConflictToast(decision.row.display_name),
              });
              reload();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
