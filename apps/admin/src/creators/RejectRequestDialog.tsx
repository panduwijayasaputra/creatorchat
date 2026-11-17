import { useEffect, useState } from 'react';
import {
  AlreadyReviewedDetailsSchema,
  ErrorCode,
  REJECT_REASON_REQUIRED,
  RejectCreatorRequestSchema,
  type RejectCreatorRequestResponse,
} from '@creatorchat/contracts';
import { ConfirmDialog, XIcon } from '@creatorchat/ui';
import { ApiError, type CreatorReviewApi } from '../auth/api-client';
import { REJECT_COPY, REVIEW_GAP_COPY } from './copy';
import { RequestTarget } from './RequestTarget';
import styles from './review-dialog.module.css';
import { useRequestReview } from './useRequestReview';

export type RejectDecision =
  | { kind: 'rejected'; response: RejectCreatorRequestResponse }
  | { kind: 'already_reviewed'; status: 'APPROVED' | 'REJECTED' };

export interface RejectRequestDialogProps {
  /** The creator application id (never a user id). */
  requestId: string;
  open: boolean;
  api: Pick<CreatorReviewApi, 'getCreatorRequest' | 'rejectCreatorRequest'>;
  onClose: () => void;
  onDecided: (decision: RejectDecision) => void;
}

/**
 * `AdmDlgReject` / `AdmDlgRejectEmpty`. The reason is required: an empty or blank field keeps the
 * button inert and shows "Alasan wajib diisi."; the server enforces the same rule.
 */
export function RejectRequestDialog({
  requestId,
  open,
  api,
  onClose,
  onDecided,
}: RejectRequestDialogProps) {
  const { load, retry } = useRequestReview(api, requestId, open);
  const [failure, setFailure] = useState<string>(REVIEW_GAP_COPY.failed);

  useEffect(() => {
    if (!open) setFailure(REVIEW_GAP_COPY.failed);
  }, [open]);

  const view = load.status === 'ready' ? load.view : null;

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(REVIEW_GAP_COPY.failed);
    // The same rules the server applies (length, control characters), checked before the call.
    const parsed = RejectCreatorRequestSchema.safeParse({ reason: reason ?? '' });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? REJECT_REASON_REQUIRED);
      throw new Error('invalid reason');
    }
    try {
      const response = await api.rejectCreatorRequest(requestId, parsed.data.reason);
      onDecided({ kind: 'rejected', response });
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.CREATOR_REQUEST_ALREADY_REVIEWED) {
        const details = AlreadyReviewedDetailsSchema.safeParse(error.details);
        if (details.success) {
          onDecided({ kind: 'already_reviewed', status: details.data.status });
          return;
        }
      }
      throw error;
    }
  };

  let target = <div className={styles.skeleton} aria-hidden="true" />;
  let consequence: React.ReactNode = REJECT_COPY.consequence;
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
  }

  return (
    <ConfirmDialog
      open={open}
      destructive
      title={REJECT_COPY.title}
      icon={<XIcon size={22} strokeWidth={2} />}
      target={target}
      consequence={consequence}
      reason={{
        label: REJECT_COPY.reasonLabel,
        required: true,
        placeholder: REJECT_COPY.reasonPlaceholder,
        hint: REJECT_COPY.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={REJECT_COPY.confirm}
      confirmDisabled={!view}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
