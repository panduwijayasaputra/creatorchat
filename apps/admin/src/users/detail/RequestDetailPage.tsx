import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { instagramHandle, type UserRequestDetail } from '@creatorchat/contracts';
import {
  Button,
  CheckIcon,
  ChevronLeftIcon,
  InfoCircleIcon,
  StatusChip,
  ToastProvider,
  useToast,
  XIcon,
} from '@creatorchat/ui';
import { ApiError, type CreatorReviewApi, type UserDetailApi } from '../../auth/api-client';
import { usePageCrumbs } from '../../components/shell/page-crumbs';
import { ApproveRequestDialog } from '../../creators/ApproveRequestDialog';
import { approvedBanner, rejectedToast } from '../../creators/copy';
import detail from '../../creators/detail/creator-detail.module.css';
import { formatDateTimeWib } from '../../creators/format';
import { RejectRequestDialog } from '../../creators/RejectRequestDialog';
import { USER_DETAIL_COPY as C } from '../copy';
import page from './user-detail.module.css';

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;

type State =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; data: UserRequestDetail };

export type RequestDetailApi = Pick<UserDetailApi, 'getUserRequest'> & CreatorReviewApi;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={detail.row} style={{ '--label': '160px' } as never}>
      <div className={detail.label}>{label}</div>
      <div className={detail.value}>{children}</div>
    </div>
  );
}

/** `/users/:id/requests/:requestId` (`AdmReqDetail`, `AdmReqDetailRej`). The server checks ownership. */
export function RequestDetailPage({ api }: { api: RequestDetailApi }) {
  return (
    <ToastProvider>
      <Request api={api} />
    </ToastProvider>
  );
}

function Request({ api }: { api: RequestDetailApi }) {
  const { id = '', requestId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject' | null; open: boolean }>({
    kind: null,
    open: false,
  });
  const close = () => setDialog((d) => ({ ...d, open: false }));
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) =>
      current.status === 'ready' && current.data.request.id === requestId
        ? current
        : { status: 'loading' },
    );
    api.getUserRequest(id, requestId, controller.signal).then(
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
  }, [api, id, requestId, attempt]);

  const data = state.status === 'ready' ? state.data : null;
  usePageCrumbs(
    data
      ? [
          { label: 'Dashboard', to: '/' },
          { label: 'User', to: '/users' },
          { label: data.applicant.display_name, to: `/users/${id}` },
          { label: 'Pengajuan Creator', to: `/users/${id}/requests` },
          { label: 'Detail' },
        ]
      : null,
  );

  const back = (
    <Link to={`/users/${encodeURIComponent(id)}/requests`} className={page.back}>
      <ChevronLeftIcon size={16} strokeWidth={2} />
      {C.detail.back}
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
          <h2 className={detail.stateTitle}>{C.gap.requestNotFound}</h2>
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

  const { request, review, check } = data;
  const block = check?.block ?? null;
  const d = C.detail;
  return (
    <>
      {back}
      <div className={page.twoColsReq}>
        <section className={detail.card}>
          <h3 className={detail.cardTitle}>{d.title}</h3>
          <Row label={d.name}>{request.creator_name}</Row>
          <Row label={d.instagram}>{instagramHandle(request.instagram_url)}</Row>
          <Row label={d.type}>{TYPE_LABEL[request.creator_type]}</Row>
          <Row label={d.description}>{request.description}</Row>
          <Row label={d.rights}>{d.rightsValue}</Row>
        </section>
        <section className={detail.card}>
          {review ? (
            <>
              <h3 className={detail.cardTitle}>{d.resultTitle}</h3>
              <div className={page.chipRow}>
                <StatusChip status="rejected" />
              </div>
              <Row label={d.reviewer}>{review.reviewer_label ?? '–'}</Row>
              <Row label={d.time}>
                {review.reviewed_at ? formatDateTimeWib(review.reviewed_at) : '–'}
              </Row>
              <Row label={d.reason}>{review.reason ?? '–'}</Row>
              {review.log_id ? (
                <div className={page.buttonRow}>
                  <Link
                    to={`/logs/${encodeURIComponent(review.log_id)}`}
                    state={{
                      from: `${location.pathname}${location.search}`,
                      label: C.gap.backToRequest,
                    }}
                    tabIndex={-1}
                  >
                    <Button variant="outline">{d.viewLog}</Button>
                  </Link>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h3 className={detail.cardTitle}>{d.reviewTitle}</h3>
              <div className={page.chipRow}>
                <StatusChip status="pending" />
              </div>
              <Row label={d.submitted}>{formatDateTimeWib(request.created_at)}</Row>
              <Row label={d.subscription}>
                {block ? (
                  <StatusChip status="blocked" label={C.gap.subscriptionCount(block.count)} />
                ) : (
                  <StatusChip status="active" label="Tidak ada" />
                )}
              </Row>
              {block ? (
                <div className={`${detail.note} ${page.noteWarn}`}>
                  <InfoCircleIcon size={16} strokeWidth={2} />
                  <span>{d.blockNote}</span>
                </div>
              ) : null}
              <div className={page.buttonRow}>
                <Button
                  icon={<CheckIcon size={16} strokeWidth={2} />}
                  disabled={block !== null}
                  onClick={() => setDialog({ kind: 'approve', open: true })}
                >
                  Setujui
                </Button>
                <Button
                  variant="danger"
                  icon={<XIcon size={16} strokeWidth={2} />}
                  onClick={() => setDialog({ kind: 'reject', open: true })}
                >
                  Tolak
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
      <ApproveRequestDialog
        requestId={request.id}
        open={dialog.open && dialog.kind === 'approve'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          if (result.kind === 'approved') {
            toast.show({ message: approvedBanner(request.creator_name) });
            void navigate(`/creators/${encodeURIComponent(result.response.creator.id)}`);
          } else {
            reload();
          }
        }}
      />
      <RejectRequestDialog
        requestId={request.id}
        open={dialog.open && dialog.kind === 'reject'}
        api={api}
        onClose={close}
        onDecided={(result) => {
          close();
          if (result.kind === 'rejected') {
            toast.show({ message: rejectedToast(result.response.request.creator_name) });
          }
          reload();
        }}
      />
    </>
  );
}
