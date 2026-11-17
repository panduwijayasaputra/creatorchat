import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { CreatorDetail, CreatorListRow } from '@creatorchat/contracts';
import { Button, Tabs, ToastProvider, useToast } from '@creatorchat/ui';
import type {
  CreatorDetailApi,
  CreatorModerationApi,
  CreatorGalleryApi,
  CreatorReviewApi,
  SubscriptionDetailApi,
  UserSubscriptionsApi,
} from '../../auth/api-client';
import { usePageCrumbs } from '../../components/shell/page-crumbs';
import { NotImplemented } from '../../components/NotImplemented';
import { ApproveRequestDialog } from '../ApproveRequestDialog';
import { BlockCreatorDialog } from '../BlockCreatorDialog';
import {
  approvedBanner,
  blockedToast,
  DETAIL_COPY,
  rejectedToast,
  statusConflictToast,
  unblockedToast,
  HISTORY_COPY,
  SUBSCRIBERS_COPY,
} from '../copy';
import { RejectRequestDialog } from '../RejectRequestDialog';
import { UnblockCreatorDialog } from '../UnblockCreatorDialog';
import styles from './creator-detail.module.css';
import { DetailHeader } from './DetailHeader';
import { HistoryTab } from './HistoryTab';
import { GalleryTab } from './gallery/GalleryTab';
import { SubscribersTab } from './subscribers/SubscribersTab';
import { CreatorSummary, RequestSummary } from './Summary';
import { useCreatorDetail } from './useCreatorDetail';

export type CreatorDetailPageApi = CreatorDetailApi &
  CreatorReviewApi &
  CreatorModerationApi &
  SubscriptionDetailApi &
  UserSubscriptionsApi &
  CreatorGalleryApi;

const TABS = DETAIL_COPY.tabs;
const tabIds: readonly string[] = TABS.map((t) => t.id);

/** A list row for the block dialogs, built from the detail (the dialogs only read identity fields). */
function rowOf(detail: CreatorDetail): CreatorListRow {
  return {
    kind: 'creator',
    id: detail.id,
    status: detail.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE',
    creator_name: detail.creator_name,
    avatar_url: detail.avatar_url,
    telegram_username: detail.telegram_username,
    telegram_id: detail.telegram_id,
    instagram_url: detail.instagram_url,
    creator_type: detail.creator_type,
    subscriber_count: detail.creator?.subscriber_count ?? null,
    has_active_subscription: false,
    date: detail.since,
  };
}

type Dialog = 'approve' | 'reject' | 'block' | 'unblock' | null;

/**
 * `/creators/:id` (+ `/:tab`): a pending request or a creator account. The server decides which; if
 * the canonical id differs from the URL (an approved application) the URL is replaced.
 */
export function CreatorDetailPage({ api }: { api: CreatorDetailPageApi }) {
  return (
    <ToastProvider>
      <Detail api={api} />
    </ToastProvider>
  );
}

function Detail({ api }: { api: CreatorDetailPageApi }) {
  const { id = '', tab: tabParam } = useParams();
  const tab = tabParam ?? 'ringkasan';
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { state, reload } = useCreatorDetail(api, id);
  const [dialog, setDialog] = useState<{ kind: Dialog; open: boolean }>({
    kind: null,
    open: false,
  });
  const open = (kind: Exclude<Dialog, null>) => setDialog({ kind, open: true });
  const close = () => setDialog((d) => ({ ...d, open: false }));

  const detail = state.status === 'ready' ? state.detail : null;
  usePageCrumbs(
    detail
      ? [
          { label: 'Dashboard', to: '/' },
          { label: 'Creator', to: '/creators' },
          ...(tab === 'ringkasan'
            ? [{ label: detail.creator_name }]
            : [
                { label: detail.creator_name, to: `/creators/${detail.id}` },
                { label: TABS.find((t) => t.id === tab)?.label ?? '' },
              ]),
        ]
      : null,
  );

  if (!tabIds.includes(tab)) return <Navigate to={`/creators/${id}`} replace />;
  const base = (canonical: string) => `/creators/${encodeURIComponent(canonical)}`;
  // The server resolved the id to another one (approved application → creator).
  if (detail && detail.id !== id) {
    return <Navigate to={`${base(detail.id)}${tab === 'ringkasan' ? '' : `/${tab}`}`} replace />;
  }

  if (state.status === 'loading') {
    return (
      <div className={styles.state} role="status">
        <p className={styles.stateText}>{DETAIL_COPY.gap.loading}</p>
      </div>
    );
  }
  if (state.status === 'not_found') {
    return (
      <div className={styles.state}>
        <h2 className={styles.stateTitle}>{DETAIL_COPY.gap.notFoundTitle}</h2>
        <Link to="/creators" className={styles.link}>
          {DETAIL_COPY.gap.notFoundBack}
        </Link>
      </div>
    );
  }
  if (state.status === 'error' || !detail) {
    return (
      <div className={styles.state} role="alert">
        <p className={styles.stateText}>{DETAIL_COPY.gap.loadFailed}</p>
        <Button variant="outline" onClick={reload}>
          {DETAIL_COPY.gap.retry}
        </Button>
      </div>
    );
  }

  const requestId = detail.request?.id ?? detail.id;
  return (
    <div className={styles.page}>
      <DetailHeader
        detail={detail}
        handlers={{
          onApprove: () => open('approve'),
          onReject: () => open('reject'),
          onBlock: () => open('block'),
          onUnblock: () => open('unblock'),
        }}
      />
      <div className={styles.tabs}>
        <Tabs
          label="Detail creator"
          items={TABS}
          value={tab}
          onChange={(next) =>
            void navigate(`${base(detail.id)}${next === 'ringkasan' ? '' : `/${next}`}`)
          }
        />
      </div>
      <div className={styles.body}>
        {tab === 'ringkasan' ? (
          detail.kind === 'request' ? (
            <RequestSummary detail={detail} />
          ) : (
            <CreatorSummary detail={detail} />
          )
        ) : tab === 'subscribers' && detail.kind === 'creator' ? (
          <SubscribersTab
            api={api}
            creator={{ id: detail.id, display_name: detail.creator_name }}
            creatorBlocked={detail.status === 'BLOCKED'}
            onChanged={reload}
          />
        ) : tab === 'subscribers' ? (
          <div className={styles.state}>
            <p className={styles.stateText}>{SUBSCRIBERS_COPY.gap.requestEmpty}</p>
          </div>
        ) : tab === 'gallery' && detail.kind === 'creator' ? (
          <GalleryTab api={api} creatorId={detail.id} />
        ) : tab === 'history' ? (
          <HistoryTab
            load={(query, signal) => api.listCreatorHistory(detail.id, query, signal)}
            backState={{
              from: `${location.pathname}${location.search}`,
              label: HISTORY_COPY.backToCreatorHistory,
            }}
          />
        ) : (
          <NotImplemented />
        )}
      </div>

      <ApproveRequestDialog
        requestId={requestId}
        open={dialog.open && dialog.kind === 'approve'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          if (result.kind === 'approved') {
            toast.show({ message: approvedBanner(detail.creator_name) });
            void navigate(base(result.response.creator.id), { replace: true });
          } else {
            reload();
          }
        }}
      />
      <RejectRequestDialog
        requestId={requestId}
        open={dialog.open && dialog.kind === 'reject'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          if (result.kind === 'rejected') {
            toast.show({ message: rejectedToast(result.response.request.creator_name) });
            void navigate('/creators');
          } else {
            reload();
          }
        }}
      />
      <BlockCreatorDialog
        row={rowOf(detail)}
        open={dialog.open && dialog.kind === 'block'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          toast.show({
            message:
              result.kind === 'blocked'
                ? blockedToast(detail.creator_name)
                : statusConflictToast(detail.creator_name),
          });
          reload();
        }}
      />
      <UnblockCreatorDialog
        row={rowOf(detail)}
        open={dialog.open && dialog.kind === 'unblock'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          toast.show({
            message:
              result.kind === 'unblocked'
                ? unblockedToast(detail.creator_name)
                : statusConflictToast(detail.creator_name),
          });
          reload();
        }}
      />
    </div>
  );
}
