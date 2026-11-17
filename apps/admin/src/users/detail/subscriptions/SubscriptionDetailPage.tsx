import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  SUBSCRIBER_PAGE_SIZES,
  type SubscriptionDetailResponse,
  type SubscriptionEventRow,
  type SubscriptionEventsQuery,
  type SubscriptionEventsResponse,
  type SubscriptionRow,
} from '@creatorchat/contracts';
import {
  Button,
  ChevronLeftIcon,
  DataTable,
  EyeIcon,
  StatusChip,
  ToastProvider,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import {
  ApiError,
  type SubscriptionDetailApi,
  type UserSubscriptionsApi,
} from '../../../auth/api-client';
import { usePageCrumbs } from '../../../components/shell/page-crumbs';
import styles from '../../../creators/creators-page.module.css';
import detail from '../../../creators/detail/creator-detail.module.css';
import { formatClockWib, formatDateWib, formatDateTimeWib } from '../../../creators/format';
import { SUB_DETAIL_COPY as C } from '../../copy';
import page from '../user-detail.module.css';
import { AccessDialogsHost, type AccessDialog } from './AccessDialogsHost';
import { eventsSearchParams, parseEventsSearch } from './events-url';
import mine from './subscriptions.module.css';

const CHIP = { ACTIVE: 'active', EXPIRED: 'expired', REVOKED: 'revoked' } as const;
const eventTime = (iso: string) => `${formatDateWib(iso)}, ${formatClockWib(iso)}`;

type State =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; data: SubscriptionDetailResponse };
type Events =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SubscriptionEventsResponse };

export type SubscriptionDetailPageApi = SubscriptionDetailApi & UserSubscriptionsApi;

/** `/users/:id/subscriptions/:subId` (`AdmSubDetail`): one subscription and its access history. */
export function SubscriptionDetailPage({ api }: { api: SubscriptionDetailPageApi }) {
  return (
    <ToastProvider>
      <Detail api={api} />
    </ToastProvider>
  );
}

function Detail({ api }: { api: SubscriptionDetailPageApi }) {
  const { id = '', subId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseEventsSearch(params), [params]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [events, setEvents] = useState<Events>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<AccessDialog>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    apiRef.current.getSubscription(id, subId, controller.signal).then(
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
  }, [id, subId, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setEvents({ status: 'loading' });
    apiRef.current.listSubscriptionEvents(id, subId, query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setEvents({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setEvents({ status: 'error' });
      },
    );
    return () => controller.abort();
    // `key` stands for the content of `query`.
  }, [id, subId, key, attempt]);

  const update = useCallback(
    (next: SubscriptionEventsQuery, replace = false) =>
      setParams(eventsSearchParams(next), { replace }),
    [setParams],
  );
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const data = state.status === 'ready' ? state.data : null;
  const listUrl = from ?? `/users/${encodeURIComponent(id)}/subscriptions`;
  usePageCrumbs(
    data
      ? [
          { label: 'Dashboard', to: '/' },
          { label: 'User', to: '/users' },
          { label: data.customer.display_name, to: `/users/${id}` },
          { label: C.title },
        ]
      : null,
  );

  const back = (
    <Link to={listUrl} className={page.back}>
      <ChevronLeftIcon size={16} strokeWidth={2} />
      {C.back}
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
  if (state.status === 'error' || !data) {
    return (
      <>
        {back}
        <div className={detail.state} role="alert">
          <p className={detail.stateText}>{C.gap.loadFailed}</p>
          <Button variant="outline" onClick={reload}>
            {C.gap.retry}
          </Button>
        </div>
      </>
    );
  }

  const { subscription: sub, customer, creator } = data;
  // The US-020 dialogs take a list row; the detail carries the same facts.
  const row: SubscriptionRow = {
    id: sub.id,
    creator: { id: creator.id, display_name: creator.display_name, avatar_url: null },
    status: sub.status,
    starts_at: sub.starts_at,
    ends_at: sub.ends_at,
    revoked_at: sub.revoked_at,
  };
  const active = sub.status === 'ACTIVE';

  const columns: Column<SubscriptionEventRow>[] = [
    {
      key: 'time',
      header: C.columns.time,
      sortable: true,
      width: '150px',
      render: (r) => <span className={styles.nowrap}>{eventTime(r.at)}</span>,
    },
    {
      key: 'actor',
      header: C.columns.actor,
      sortable: true,
      width: '110px',
      render: (r) => r.actor,
    },
    {
      key: 'action',
      header: C.columns.action,
      sortable: true,
      width: '110px',
      render: (r) => r.action,
    },
    { key: 'summary', header: C.columns.summary, width: '70px', render: (r) => r.summary },
    {
      key: 'status',
      header: C.columns.status,
      width: '100px',
      render: () => <StatusChip status="success" />,
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: '90px',
      render: (r) => (
        <Button
          size="table"
          variant="outline"
          className={styles.compact}
          icon={<EyeIcon size={16} strokeWidth={2} />}
          aria-label={`View ${r.action}`}
          disabled={r.log_id === null}
          {...(r.log_id === null ? { title: C.gap.noLog } : {})}
          onClick={() =>
            void navigate(`/logs/${encodeURIComponent(r.log_id as string)}`, {
              state: {
                from: `${location.pathname}${location.search}`,
                label: C.gap.backToSubscription,
              },
            })
          }
        >
          View
        </Button>
      ),
    },
  ];
  const sort: SortState = { key: query.sort, direction: query.dir };
  const user = {
    id: customer.id,
    display_name: customer.display_name,
    telegram_username: customer.telegram_username,
    telegram_id: customer.telegram_id,
  };

  return (
    <>
      {back}
      <div className={mine.detailGrid}>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>
            {C.card(customer.display_name, creator.display_name)}
          </h3>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.status}</div>
            <div className={detail.value}>
              <StatusChip status={CHIP[sub.status]} />
            </div>
          </div>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.starts}</div>
            <div className={detail.value}>{formatDateWib(sub.starts_at)}</div>
          </div>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.ends}</div>
            <div className={detail.value}>{formatDateTimeWib(sub.ends_at)}</div>
          </div>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.source}</div>
            <div className={detail.value}>{C.sourceValue}</div>
          </div>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.createdBy}</div>
            <div className={detail.value}>{sub.created_by_label ?? '–'}</div>
          </div>
          <div className={detail.row} style={{ '--label': '150px' } as never}>
            <div className={detail.label}>{C.payment}</div>
            <div className={detail.value}>{C.paymentValue}</div>
          </div>
          <div className={page.buttonRow}>
            {active ? (
              <>
                <Button variant="outline" onClick={() => setDialog({ kind: 'extend', row })}>
                  {C.extend}
                </Button>
                <Button
                  variant="outline"
                  className={mine.danger}
                  onClick={() => setDialog({ kind: 'revoke', row })}
                >
                  {C.revoke}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setDialog({ kind: 'grant', row })}>
                {C.regrant}
              </Button>
            )}
          </div>
        </section>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>{C.eventsTitle}</h3>
          <div className={mine.eventsTable}>
            <DataTable<SubscriptionEventRow>
              bare
              dense
              label="Riwayat akses"
              columns={columns}
              rows={events.status === 'ready' ? events.data.items : []}
              status={events.status}
              rowKey={(r) => r.id}
              sort={sort}
              onSortChange={(next) =>
                update({
                  ...query,
                  sort: next.key as SubscriptionEventsQuery['sort'],
                  dir: next.direction,
                  page: 1,
                })
              }
              hasActiveFilters={false}
              onResetFilters={() => undefined}
              onRetry={reload}
              minWidth={680}
              pagination={{
                page: query.page,
                pageSize: query.page_size,
                total: events.status === 'ready' ? events.data.total : 0,
                onPageChange: (p) => update({ ...query, page: p }),
                onPageSizeChange: (size) =>
                  update({
                    ...query,
                    page_size: (SUBSCRIBER_PAGE_SIZES as readonly number[]).includes(size)
                      ? (size as SubscriptionEventsQuery['page_size'])
                      : 10,
                    page: 1,
                  }),
              }}
            />
          </div>
        </section>
      </div>
      <AccessDialogsHost
        user={user}
        dialog={dialog}
        api={api}
        onClose={() => setDialog(null)}
        onChanged={reload}
      />
    </>
  );
}
