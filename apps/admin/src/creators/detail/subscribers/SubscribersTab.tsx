import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  SUBSCRIBER_PAGE_SIZES,
  type CreatorSubscriberRow,
  type CreatorSubscribersQuery,
  type CreatorSubscribersResponse,
  type SubscriptionRow,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  PlusIcon,
  SearchInput,
  Select,
  StatusChip,
  TableToolbar,
  useToast,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { SubscriptionDetailApi, UserSubscriptionsApi } from '../../../auth/api-client';
import { ACCESS_COPY } from '../../../users/copy';
import { GrantAccessDialog } from '../../../users/detail/subscriptions/GrantAccessDialog';
import {
  AccessDialogsHost,
  type AccessDialog,
} from '../../../users/detail/subscriptions/AccessDialogsHost';
import type { AccessUser } from '../../../users/detail/subscriptions/AccessTarget';
import { SUBSCRIBERS_COPY as C } from '../../copy';
import styles from '../../creators-page.module.css';
import { formatDateWib, initialsOf } from '../../format';
import { paletteFor } from '../../RequestTarget';
import {
  isDefaultSubscribersFilter,
  parseSubscribersSearch,
  resetSubscribersFilters,
  subscribersSearchParams,
} from './subscribers-url';
import mine from './subscribers.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const toOptions = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));
const statusOptions = toOptions(C.statusOptions);
const endsOptions = toOptions(C.endsOptions);
const CHIP = { ACTIVE: 'active', EXPIRED: 'expired', REVOKED: 'revoked' } as const;

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: CreatorSubscribersResponse };

export type SubscribersTabApi = SubscriptionDetailApi & UserSubscriptionsApi;

function SubscriberCell({ row }: { row: CreatorSubscriberRow }) {
  const colour = paletteFor(row.customer.id);
  return (
    <div className={styles.identity}>
      {row.customer.avatar_url ? (
        <img
          className={styles.disc}
          src={row.customer.avatar_url}
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
          {initialsOf(row.customer.display_name)}
        </span>
      )}
      <span className={styles.name}>{row.customer.display_name}</span>
    </div>
  );
}

/**
 * The creator's Subscriber tab (`AdmCrSubs`): customers filtered and paged by the server, with the
 * US-020 actions. `onChanged` runs after any access change so the creator detail refetches too.
 */
export function SubscribersTab({
  api,
  creator,
  creatorBlocked,
  onChanged,
}: {
  api: SubscribersTabApi;
  creator: { id: string; display_name: string };
  creatorBlocked: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseSubscribersSearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [grantOpen, setGrantOpen] = useState(false);
  const [row, setRow] = useState<{ dialog: AccessDialog; user: AccessUser } | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRef.current.listCreatorSubscribers(creator.id, query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [creator.id, key, attempt]);

  const update = useCallback(
    (next: CreatorSubscribersQuery, replace = false) =>
      setParams(subscribersSearchParams(next), { replace }),
    [setParams],
  );
  const changed = () => {
    setAttempt((n) => n + 1);
    onChanged();
  };

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
    update(resetSubscribersFilters(query));
  };

  // The US-020 dialogs take a list row; a subscriber row carries the same facts.
  const asRow = (r: CreatorSubscriberRow): SubscriptionRow => ({
    id: r.id,
    creator: { id: creator.id, display_name: creator.display_name, avatar_url: null },
    status: r.status,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    revoked_at: r.revoked_at,
  });
  const asUser = (r: CreatorSubscriberRow): AccessUser => ({
    id: r.customer.id,
    display_name: r.customer.display_name,
    telegram_username: r.customer.telegram_username,
    telegram_id: r.customer.telegram_id,
  });
  const open = (kind: 'extend' | 'revoke' | 'grant', r: CreatorSubscriberRow) =>
    setRow({ dialog: { kind, row: asRow(r) }, user: asUser(r) });

  const columns: Column<CreatorSubscriberRow>[] = [
    {
      key: 'subscriber',
      header: C.columns.subscriber,
      sortable: true,
      render: (r) => <SubscriberCell row={r} />,
    },
    {
      key: 'telegram',
      header: C.columns.telegram,
      sortable: true,
      width: '170px',
      render: (r) => (
        <div>
          <div>{r.customer.telegram_username ? `@${r.customer.telegram_username}` : '–'}</div>
          <div className={styles.sub}>ID {r.customer.telegram_id}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: C.columns.status,
      sortable: true,
      width: '140px',
      render: (r) => <StatusChip status={CHIP[r.status]} />,
    },
    {
      key: 'starts',
      header: C.columns.starts,
      sortable: true,
      width: '120px',
      render: (r) => <span className={styles.nowrap}>{formatDateWib(r.starts_at)}</span>,
    },
    {
      key: 'ends',
      header: C.columns.ends,
      sortable: true,
      width: '120px',
      render: (r) => <span className={styles.nowrap}>{formatDateWib(r.ends_at)}</span>,
    },
    {
      key: 'actions',
      header: C.columns.actions,
      width: '300px',
      render: (r) => {
        const name = r.customer.display_name;
        return (
          <div className={mine.actions}>
            <Button
              size="table"
              variant="outline"
              className={styles.compact}
              icon={<EyeIcon size={16} strokeWidth={2} />}
              aria-label={`View ${name}`}
              onClick={() =>
                void navigate(`/users/${encodeURIComponent(r.customer.id)}`, {
                  state: { from: `${location.pathname}${location.search}` },
                })
              }
            >
              View
            </Button>
            {r.status === 'ACTIVE' ? (
              <>
                <Button
                  size="table"
                  variant="outline"
                  className={styles.compact}
                  aria-label={`Perpanjang akses ${name}`}
                  onClick={() => open('extend', r)}
                >
                  {C.extend}
                </Button>
                <Button
                  size="table"
                  variant="outline"
                  className={`${styles.compact} ${mine.danger}`}
                  aria-label={`Cabut akses ${name}`}
                  onClick={() => open('revoke', r)}
                >
                  {C.revoke}
                </Button>
              </>
            ) : (
              <Button
                size="table"
                variant="outline"
                className={styles.compact}
                aria-label={`Berikan ulang akses ${name}`}
                disabled={creatorBlocked}
                {...(creatorBlocked ? { title: C.gap.grantBlocked } : {})}
                onClick={() => open('grant', r)}
              >
                {C.regrant}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const sort: SortState = { key: query.sort, direction: query.dir };
  return (
    <>
      <DataTable<CreatorSubscriberRow>
        bare
        dense
        label="Subscriber"
        columns={columns}
        rows={state.status === 'ready' ? state.data.items : []}
        status={state.status}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as CreatorSubscribersQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultSubscribersFilter(query)}
        onResetFilters={reset}
        onRetry={() => setAttempt((n) => n + 1)}
        toolbar={
          <TableToolbar
            onReset={reset}
            actions={
              <Button
                className={mine.addButton}
                icon={<PlusIcon size={16} strokeWidth={2} />}
                disabled={creatorBlocked}
                {...(creatorBlocked ? { title: C.gap.grantBlocked } : {})}
                onClick={() => setGrantOpen(true)}
              >
                {C.grant}
              </Button>
            }
          >
            <SearchInput
              aria-label={C.search}
              placeholder={C.search}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={styles.search}
            />
            <Select
              label="Status akses"
              value={query.status}
              options={statusOptions}
              onChange={(value) =>
                update({ ...query, status: value as CreatorSubscribersQuery['status'], page: 1 })
              }
            />
            <Select
              label="Berakhir"
              value={query.ends}
              options={endsOptions}
              onChange={(value) =>
                update({ ...query, ends: value as CreatorSubscribersQuery['ends'], page: 1 })
              }
            />
          </TableToolbar>
        }
        minWidth={980}
        pagination={{
          page: query.page,
          pageSize: query.page_size,
          total: state.status === 'ready' ? state.data.total : 0,
          onPageChange: (p) => update({ ...query, page: p }),
          onPageSizeChange: (size) =>
            update({
              ...query,
              page_size: (SUBSCRIBER_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as CreatorSubscribersQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
      {row ? (
        <AccessDialogsHost
          user={row.user}
          dialog={row.dialog}
          api={api}
          onClose={() => setRow(null)}
          onChanged={changed}
        />
      ) : null}
      <GrantAccessDialog
        open={grantOpen}
        picker
        api={api}
        lockedCreator={creator}
        onClose={() => setGrantOpen(false)}
        onDecided={(decision, creatorName, user) => {
          setGrantOpen(false);
          toast.show({
            message:
              decision.kind === 'done'
                ? ACCESS_COPY.grantedToast(
                    user.display_name,
                    creatorName,
                    formatDateWib(decision.subscription.ends_at),
                  )
                : ACCESS_COPY.gap.conflictToast(user.display_name),
          });
          changed();
        }}
      />
    </>
  );
}
