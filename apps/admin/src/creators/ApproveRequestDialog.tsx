import { useEffect, useState } from 'react';
import {
  AlreadyReviewedDetailsSchema,
  ApprovalBlockSchema,
  ErrorCode,
  type ApprovalBlock,
  type ApproveCreatorRequestResponse,
} from '@creatorchat/contracts';
import { AlertCircleIcon, CheckCircleIcon, ConfirmDialog, UserSlashIcon } from '@creatorchat/ui';
import { ApiError, type CreatorReviewApi } from '../auth/api-client';
import { APPROVE_COPY, REVIEW_GAP_COPY } from './copy';
import { formatClockWib, formatDateWib } from './format';
import { RequestTarget } from './RequestTarget';
import styles from './review-dialog.module.css';
import { useRequestReview } from './useRequestReview';

export type ApproveDecision =
  | { kind: 'approved'; response: ApproveCreatorRequestResponse }
  | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' };

export interface ApproveRequestDialogProps {
  /** The creator application id (never a user id). */
  requestId: string;
  open: boolean;
  api: Pick<CreatorReviewApi, 'getCreatorRequest' | 'approveCreatorRequest'>;
  onClose: () => void;
  /** Called once the server answered: approved, or somebody else decided first. */
  onDecided: (decision: ApproveDecision) => void;
}

/**
 * `AdmDlgApprove` / `AdmDlgApproveLoading` / `AdmDlgApproveFail`. Opening runs the pre-check; if a
 * customer subscription already blocks the approval the dialog opens in the "cannot approve" state.
 * The server re-checks inside the transaction, so a block that appears meanwhile (409) switches the
 * same dialog into that state.
 */
export function ApproveRequestDialog({
  requestId,
  open,
  api,
  onClose,
  onDecided,
}: ApproveRequestDialogProps) {
  const { load, retry } = useRequestReview(api, requestId, open);
  const [serverBlock, setServerBlock] = useState<ApprovalBlock | null>(null);
  const [failure, setFailure] = useState<string>(REVIEW_GAP_COPY.failed);

  useEffect(() => {
    if (!open) {
      setServerBlock(null);
      setFailure(REVIEW_GAP_COPY.failed);
    }
  }, [open]);

  const view = load.status === 'ready' ? load.view : null;
  const block = serverBlock ?? view?.check.block ?? null;

  const confirm = async (): Promise<boolean | void> => {
    setFailure(REVIEW_GAP_COPY.failed);
    try {
      const response = await api.approveCreatorRequest(requestId);
      onDecided({ kind: 'approved', response });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === ErrorCode.CREATOR_APPROVAL_BLOCKED) {
          const details = ApprovalBlockSchema.safeParse(error.details);
          if (details.success) {
            setServerBlock(details.data);
            return false; // stay open, now explaining why
          }
        }
        if (error.code === ErrorCode.CREATOR_REQUEST_ALREADY_REVIEWED) {
          const details = AlreadyReviewedDetailsSchema.safeParse(error.details);
          if (details.success) {
            onDecided({ kind: 'already_reviewed', status: details.data.status });
            return;
          }
        }
        if (error.code === ErrorCode.CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE) {
          setFailure(REVIEW_GAP_COPY.notEligible);
        }
      }
      throw error;
    }
  };

  let target = <div className={styles.skeleton} aria-hidden="true" />;
  let consequence: React.ReactNode = (
    <div className={styles.loading} role="status">
      {REVIEW_GAP_COPY.loading}
    </div>
  );
  if (load.status === 'failed') {
    consequence = (
      <div role="alert">
        {REVIEW_GAP_COPY.loadFailed}
        <button type="button" className={styles.retry} onClick={retry}>
          {REVIEW_GAP_COPY.retry}
        </button>
      </div>
    );
  } else if (view) {
    target = <RequestTarget request={view.request} />;
    consequence = block ? (
      <div className={styles.stack}>
        <div className={styles.fail}>
          <span className={styles.failDisc}>
            <AlertCircleIcon size={22} strokeWidth={2} />
          </span>
          <div className={styles.failText}>
            <div className={styles.failTitle}>{APPROVE_COPY.failTitle}</div>
            <div className={styles.failBody}>
              Akun ini masih memiliki {block.count} langganan pelanggan aktif: {block.creator_name},
              hingga {formatDateWib(block.ends_at)}. Permintaan dapat disetujui setelah seluruh
              langganan berakhir.
            </div>
          </div>
        </div>
        <div className={styles.note}>{APPROVE_COPY.failNote}</div>
      </div>
    ) : (
      <div className={styles.stack}>
        <div>
          Akun user ini akan berubah menjadi <strong>CREATOR</strong>. Ini mengubah role akun yang
          sama, bukan membuat akun baru, dan akun tidak lagi memiliki mode pelanggan.
        </div>
        <div className={styles.ok}>
          <CheckCircleIcon size={18} strokeWidth={2} />
          Diperiksa ulang: tidak ada langganan pelanggan aktif (
          {formatClockWib(view.check.checked_at)} WIB)
        </div>
        <div className={styles.note}>{APPROVE_COPY.notify}</div>
      </div>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      title={APPROVE_COPY.title}
      // The cannot-approve board swaps the check for the person-with-slash.
      icon={
        block ? (
          <UserSlashIcon size={22} strokeWidth={2} />
        ) : (
          <CheckCircleIcon size={22} strokeWidth={2} />
        )
      }
      target={target}
      consequence={consequence}
      confirmLabel={APPROVE_COPY.confirm}
      pendingLabel={APPROVE_COPY.pending}
      confirmDisabled={!view || block !== null}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
