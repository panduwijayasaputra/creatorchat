import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  SUBSCRIPTION_PAGE_SIZES,
  type SubscriptionListQuery,
  type SubscriptionListResponse,
  type SubscriptionRow,
} from '@creatorchat/contracts';
import {
  Button,
  DataTable,
  EyeIcon,
  InfoCircleIcon,
  PlusIcon,
  SearchInput,
  Select,
  StatusChip,
  TableToolbar,
  useToast,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import type { PendingAccessRequest } from '@creatorchat/contracts';
import type { UserSubscriptionsApi } from '../../../auth/api-client';
import styles from '../../../creators/creators-page.module.css';
import { formatDateWib, initialsOf } from '../../../creators/format';
import { paletteFor } from '../../../creators/RequestTarget';
import { ACCESS_COPY as C, ACCESS_REQUEST_COPY as R } from '../../copy';
import type { AccessUser } from './AccessTarget';
import type { AccessDecision } from './access-decision';
import { AccessRequestBanners } from './AccessRequestBanners';
import { ExtendAccessDialog } from './ExtendAccessDialog';
import { GrantAccessDialog } from './GrantAccessDialog';
import { RejectAccessRequestDialog } from './RejectAccessRequestDialog';
import { RevokeAccessDialog } from './RevokeAccessDialog';
import {
  isDefaultSubscriptionsFilter,
  parseSubscriptionsSearch,
  resetSubscriptionsFilters,
  subscriptionsSearchParams,
} from './subscriptions-url';
import { useAccessRequests } from './useAccessRequests';
import mine from './subscriptions.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const toOptions = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));
const statusOptions = toOptions(C.statusOptions);
const endsOptions = toOptions(C.endsOptions);

const CHIP = { ACTIVE: 'active', EXPIRED: 'expired', REVOKED: 'revoked' } as const;

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: SubscriptionListResponse };
type Dialog =
  | { kind: 'grant'; row?: SubscriptionRow; request?: PendingAccessRequest }
  | { kind: 'reject'; request: PendingAccessRequest }
  | { kind: 'extend'; row: SubscriptionRow }
  | { kind: 'revoke'; row: SubscriptionRow }
  | null;

function CreatorCell({ row }: { row: SubscriptionRow }) {
  const colour = paletteFor(row.creator.id);
  return (
    <div className={styles.identity}>
      {row.creator.avatar_url ? (
        <img
          className={styles.disc}
          src={row.creator.avatar_url}
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
          {initialsOf(row.creator.display_name)}
        </span>
      )}
      <span className={styles.name}>{row.creator.display_name}</span>
    </div>
  );
}

/** `AdmUserSubs`: the user's access to creators, filtered and paged by the server, with the three actions. */
export function SubscriptionsTab({
  api,
  user,
  blocked,
}: {
  api: UserSubscriptionsApi;
  user: AccessUser;
  /** A BLOCKED account cannot be granted access (the server refuses it too). */
  blocked: boolean;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseSubscriptionsSearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const requests = useAccessRequests(api, user.id);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    apiRef.current.listUserSubscriptions(user.id, query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [user.id, key, attempt]);

  const update = useCallback(
    (next: SubscriptionListQuery, replace = false) =>
      setParams(subscriptionsSearchParams(next), { replace }),
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
    update(resetSubscriptionsFilters(query));
  };

  const decided = (decision: AccessDecision, message: (endsAt: string) => string) => {
    setDialog(null);
    toast.show({
      message:
        decision.kind === 'done'
          ? message(decision.subscription.ends_at)
          : C.gap.conflictToast(user.display_name),
    });
    setAttempt((n) => n + 1);
    requests.refetch();
  };

  const columns: Column<SubscriptionRow>[] = [
    {
      key: 'creator',
      header: C.columns.creator,
      sortable: true,
      render: (row) => <CreatorCell row={row} />,
    },
    {
      key: 'status',
      header: C.columns.status,
      sortable: true,
      width: '140px',
      render: (row) => <StatusChip status={CHIP[row.status]} />,
    },
    {
      key: 'starts',
      header: C.columns.starts,
      sortable: true,
      width: '130px',
      render: (row) => <span className={styles.nowrap}>{formatDateWib(row.starts_at)}</span>,
    },
    {
      key: 'ends',
      header: C.columns.ends,
      sortable: true,
      width: '130px',
      render: (row) => <span className={styles.nowrap}>{formatDateWib(row.ends_at)}</span>,
    },
    {
      key: 'actions',
      header: C.columns.actions,
      width: '280px',
      render: (row) => (
        <div className={mine.actions}>
          <Button
            size="table"
            variant="outline"
            className={styles.compact}
            icon={<EyeIcon size={16} strokeWidth={2} />}
            aria-label={`View akses ${row.creator.display_name}`}
            onClick={() =>
              void navigate(
                `/users/${encodeURIComponent(user.id)}/subscriptions/${encodeURIComponent(row.id)}`,
                { state: { from: `${location.pathname}${location.search}` } },
              )
            }
          >
            View
          </Button>
          {row.status === 'ACTIVE' ? (
            <>
              <Button
                size="table"
                variant="outline"
                className={styles.compact}
                aria-label={`Perpanjang akses ${row.creator.display_name}`}
                onClick={() => setDialog({ kind: 'extend', row })}
              >
                {C.extend}
              </Button>
              <Button
                size="table"
                variant="outline"
                className={`${styles.compact} ${mine.danger}`}
                aria-label={`Cabut akses ${row.creator.display_name}`}
                onClick={() => setDialog({ kind: 'revoke', row })}
              >
                {C.revoke}
              </Button>
            </>
          ) : (
            <Button
              size="table"
              variant="outline"
              className={styles.compact}
              aria-label={`Berikan ulang akses ${row.creator.display_name}`}
              disabled={blocked}
              {...(blocked ? { title: C.gap.grantBlocked } : {})}
              onClick={() => setDialog({ kind: 'grant', row })}
            >
              {C.regrant}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const sort: SortState = { key: query.sort, direction: query.dir };
  return (
    <>
      <AccessRequestBanners
        state={requests.state}
        blocked={blocked}
        onApprove={(request) => setDialog({ kind: 'grant', request })}
        onReject={(request) => setDialog({ kind: 'reject', request })}
        onRetry={requests.refetch}
      />
      <DataTable<SubscriptionRow>
        bare
        dense
        label="Langganan user"
        columns={columns}
        rows={state.status === 'ready' ? state.data.items : []}
        status={state.status}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(next) =>
          update({
            ...query,
            sort: next.key as SubscriptionListQuery['sort'],
            dir: next.direction,
            page: 1,
          })
        }
        hasActiveFilters={!isDefaultSubscriptionsFilter(query)}
        onResetFilters={reset}
        onRetry={() => setAttempt((n) => n + 1)}
        toolbar={
          <TableToolbar
            onReset={reset}
            actions={
              <Button
                className={mine.addButton}
                icon={<PlusIcon size={16} strokeWidth={2} />}
                disabled={blocked}
                {...(blocked ? { title: C.gap.grantBlocked } : {})}
                onClick={() => setDialog({ kind: 'grant' })}
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
              label="Status"
              value={query.status}
              options={statusOptions}
              onChange={(value) =>
                update({ ...query, status: value as SubscriptionListQuery['status'], page: 1 })
              }
            />
            <Select
              label="Berakhir"
              value={query.ends}
              options={endsOptions}
              onChange={(value) =>
                update({ ...query, ends: value as SubscriptionListQuery['ends'], page: 1 })
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
              page_size: (SUBSCRIPTION_PAGE_SIZES as readonly number[]).includes(size)
                ? (size as SubscriptionListQuery['page_size'])
                : 10,
              page: 1,
            }),
        }}
      />
      <div className={mine.note}>
        <InfoCircleIcon size={18} strokeWidth={2} />
        <span>{C.note}</span>
      </div>
      <GrantAccessDialog
        user={user}
        open={dialog?.kind === 'grant'}
        api={api}
        lockedCreator={
          dialog?.kind === 'grant' ? (dialog.row?.creator ?? dialog.request?.creator) : undefined
        }
        accessRequestId={dialog?.kind === 'grant' ? dialog.request?.id : undefined}
        onClose={() => setDialog(null)}
        onDecided={(decision, creator) =>
          decided(decision, (endsAt) =>
            C.grantedToast(user.display_name, creator, formatDateWib(endsAt)),
          )
        }
      />
      {dialog?.kind === 'reject' ? (
        <RejectAccessRequestDialog
          user={user}
          request={dialog.request}
          open
          api={api}
          onClose={() => setDialog(null)}
          onDecided={(decision) => {
            setDialog(null);
            toast.show({
              message:
                decision.kind === 'rejected'
                  ? R.rejectedToast(user.display_name, dialog.request.creator.display_name)
                  : R.reviewedToast(user.display_name),
            });
            requests.refetch();
          }}
        />
      ) : null}
      {dialog?.kind === 'extend' ? (
        <ExtendAccessDialog
          user={user}
          row={dialog.row}
          open
          api={api}
          onClose={() => setDialog(null)}
          onDecided={(decision) =>
            decided(decision, (endsAt) =>
              C.extendedToast(
                user.display_name,
                dialog.row.creator.display_name,
                formatDateWib(endsAt),
              ),
            )
          }
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeAccessDialog
          user={user}
          row={dialog.row}
          open
          api={api}
          onClose={() => setDialog(null)}
          onDecided={(decision) =>
            decided(decision, () =>
              C.revokedToast(user.display_name, dialog.row.creator.display_name),
            )
          }
        />
      ) : null}
    </>
  );
}
