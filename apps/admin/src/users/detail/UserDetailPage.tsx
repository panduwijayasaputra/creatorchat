import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { UserDetailResponse, UserListRow } from '@creatorchat/contracts';
import {
  Button,
  CalendarIcon,
  RefreshIcon,
  SendIcon,
  StatusChip,
  Tabs,
  ToastProvider,
  useToast,
  UserSlashIcon,
} from '@creatorchat/ui';
import type { UserDetailApi, UserModerationApi, UserSubscriptionsApi } from '../../auth/api-client';
import { NotImplemented } from '../../components/NotImplemented';
import { usePageCrumbs } from '../../components/shell/page-crumbs';
import detail from '../../creators/detail/creator-detail.module.css';
import { HistoryTab } from '../../creators/detail/HistoryTab';
import { formatDateWib, initialsOf } from '../../creators/format';
import { paletteFor } from '../../creators/RequestTarget';
import { BlockUserDialog } from '../BlockUserDialog';
import {
  USER_DETAIL_COPY as C,
  userBlockedToast,
  userConflictToast,
  userUnblockedToast,
} from '../copy';
import { UnblockUserDialog } from '../UnblockUserDialog';
import { RequestsTab } from './RequestsTab';
import { SubscriptionsTab } from './subscriptions/SubscriptionsTab';
import { useUserDetail } from './useUserDetail';
import { UserSummary } from './UserSummary';

export type UserDetailPageApi = UserDetailApi & UserModerationApi & UserSubscriptionsApi;
type UserDetail = Extract<UserDetailResponse, { role: 'USER' }>;

const tabIds: readonly string[] = C.tabs.map((t) => t.id);

/** A list row for the block dialogs, built from the detail (the dialogs only read identity fields). */
function rowOf(d: UserDetail): UserListRow {
  return {
    id: d.user.id,
    display_name: d.user.display_name,
    avatar_url: d.user.avatar_url,
    telegram_username: d.user.telegram_username,
    telegram_id: d.user.telegram_id,
    status: d.user.status,
    active_subscription_count: d.subscriptions.active_count,
    creator_request_status: d.creator_request.status,
    pending_access_count: 0,
    joined_at: d.user.joined_at,
  };
}

/**
 * `/users/:id` (+ `/:tab`): a USER account. A creator's id redirects to `/creators/:id`; an unknown
 * id is not found.
 */
export function UserDetailPage({ api }: { api: UserDetailPageApi }) {
  return (
    <ToastProvider>
      <Detail api={api} />
    </ToastProvider>
  );
}

function Detail({ api }: { api: UserDetailPageApi }) {
  const { id = '', tab: tabParam } = useParams();
  const tab = tabParam ?? 'ringkasan';
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { state, reload } = useUserDetail(api, id);
  const [dialog, setDialog] = useState<{ kind: 'block' | 'unblock' | null; open: boolean }>({
    kind: null,
    open: false,
  });
  const close = () => setDialog((d) => ({ ...d, open: false }));

  const data = state.status === 'ready' && state.detail.role === 'USER' ? state.detail : null;
  usePageCrumbs(
    data
      ? [
          { label: 'Dashboard', to: '/' },
          { label: 'User', to: '/users' },
          ...(tab === 'ringkasan'
            ? [{ label: data.user.display_name }]
            : [
                { label: data.user.display_name, to: `/users/${id}` },
                { label: C.tabs.find((t) => t.id === tab)?.label ?? '' },
              ]),
        ]
      : null,
  );

  if (!tabIds.includes(tab)) return <Navigate to={`/users/${id}`} replace />;
  if (state.status === 'ready' && state.detail.role === 'CREATOR') {
    return <Navigate to={`/creators/${state.detail.creator_id}`} replace />;
  }
  if (state.status === 'loading') {
    return (
      <div className={detail.state} role="status">
        <p className={detail.stateText}>{C.gap.loading}</p>
      </div>
    );
  }
  if (state.status === 'not_found') {
    return (
      <div className={detail.state}>
        <h2 className={detail.stateTitle}>{C.gap.notFoundTitle}</h2>
        <Link to="/users" className={detail.link}>
          {C.gap.notFoundBack}
        </Link>
      </div>
    );
  }
  if (state.status === 'error' || !data) {
    return (
      <div className={detail.state} role="alert">
        <p className={detail.stateText}>{C.gap.loadFailed}</p>
        <Button variant="outline" onClick={reload}>
          {C.gap.retry}
        </Button>
      </div>
    );
  }

  const { user } = data;
  const colour = paletteFor(user.id);
  const base = `/users/${encodeURIComponent(user.id)}`;
  const handle = user.telegram_username ? `@${user.telegram_username} · ` : '';
  const blocked = user.status === 'BLOCKED';
  return (
    <div className={detail.page}>
      <section className={detail.header} aria-label="Identitas">
        {user.avatar_url ? (
          <img
            className={detail.disc}
            src={user.avatar_url}
            alt=""
            referrerPolicy="no-referrer"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <span
            className={detail.disc}
            style={{ background: colour.bg, color: colour.fg }}
            aria-hidden="true"
          >
            {initialsOf(user.display_name)}
          </span>
        )}
        <div className={detail.who}>
          <div className={detail.nameRow}>
            <h2 className={detail.name}>{user.display_name}</h2>
            <StatusChip status={blocked ? 'blocked' : 'active'} />
          </div>
          <div className={detail.meta}>
            <span className={detail.metaItem}>
              <SendIcon size={16} strokeWidth={2} />
              {handle}ID {user.telegram_id}
            </span>
            <span className={detail.metaItem}>
              <CalendarIcon size={16} strokeWidth={2} />
              Bergabung {formatDateWib(user.joined_at)}
            </span>
          </div>
        </div>
        <div className={detail.actions}>
          {blocked ? (
            <Button
              variant="outline"
              icon={<RefreshIcon size={16} strokeWidth={2} />}
              onClick={() => setDialog({ kind: 'unblock', open: true })}
            >
              Unblock
            </Button>
          ) : (
            <Button
              variant="danger"
              icon={<UserSlashIcon size={16} strokeWidth={2} />}
              onClick={() => setDialog({ kind: 'block', open: true })}
            >
              Block
            </Button>
          )}
        </div>
      </section>
      <div className={detail.tabs}>
        <Tabs
          label="Detail user"
          items={C.tabs}
          value={tab}
          onChange={(next) => void navigate(`${base}${next === 'ringkasan' ? '' : `/${next}`}`)}
        />
      </div>
      <div className={detail.body}>
        {tab === 'ringkasan' ? (
          <UserSummary data={data} userId={user.id} />
        ) : tab === 'subscriptions' ? (
          <SubscriptionsTab
            api={api}
            blocked={blocked}
            user={{
              id: user.id,
              display_name: user.display_name,
              telegram_username: user.telegram_username,
              telegram_id: user.telegram_id,
            }}
          />
        ) : tab === 'requests' ? (
          <RequestsTab api={api} userId={user.id} />
        ) : tab === 'history' ? (
          <HistoryTab
            load={(query, signal) => api.listUserHistory(user.id, query, signal)}
            backState={{
              from: `${location.pathname}${location.search}`,
              label: C.gap.backToUserHistory,
            }}
          />
        ) : (
          <NotImplemented />
        )}
      </div>
      <BlockUserDialog
        row={rowOf(data)}
        open={dialog.open && dialog.kind === 'block'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          toast.show({
            message:
              result.kind === 'blocked'
                ? userBlockedToast(user.display_name)
                : userConflictToast(user.display_name),
          });
          reload();
        }}
      />
      <UnblockUserDialog
        row={rowOf(data)}
        open={dialog.open && dialog.kind === 'unblock'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          toast.show({
            message:
              result.kind === 'unblocked'
                ? userUnblockedToast(user.display_name)
                : userConflictToast(user.display_name),
          });
          reload();
        }}
      />
    </div>
  );
}
