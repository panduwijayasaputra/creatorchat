import { useEffect, useState } from 'react';
import {
  ErrorCode,
  REJECT_REASON_REQUIRED,
  type PendingAccessRequest,
} from '@creatorchat/contracts';
import { ConfirmDialog, XIcon } from '@creatorchat/ui';
import { ApiError, type UserSubscriptionsApi } from '../../../auth/api-client';
import { ACCESS_REQUEST_COPY as C } from '../../copy';
import { AccessTarget, type AccessUser } from './AccessTarget';
import { checkReason } from './access-decision';

export type RejectAccessDecision = { kind: 'rejected' } | { kind: 'already_reviewed' };

export interface RejectAccessRequestDialogProps {
  user: AccessUser;
  request: PendingAccessRequest;
  open: boolean;
  api: Pick<UserSubscriptionsApi, 'rejectAccessRequest'>;
  onClose: () => void;
  onDecided: (decision: RejectAccessDecision) => void;
}

/**
 * Tolak, following `AdmDlgReject`: the reason is required (the same rules as the server). A 409
 * means someone already decided: handled as "refetch", every other failure keeps the dialog open.
 * DESIGN GAP: no board for this text.
 */
export function RejectAccessRequestDialog({
  user,
  request,
  open,
  api,
  onClose,
  onDecided,
}: RejectAccessRequestDialogProps) {
  const [failure, setFailure] = useState<string>(C.rejectDialog.failed);
  useEffect(() => {
    if (open) setFailure(C.rejectDialog.failed);
  }, [open]);

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(C.rejectDialog.failed);
    const checked = checkReason(reason);
    if (!checked.ok) {
      setFailure(checked.message);
      throw new Error('invalid reason');
    }
    try {
      await api.rejectAccessRequest(user.id, request.id, checked.reason);
      onDecided({ kind: 'rejected' });
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.ACCESS_REQUEST_ALREADY_REVIEWED) {
        onDecided({ kind: 'already_reviewed' });
        return;
      }
      throw error;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      destructive
      title={C.rejectDialog.title}
      icon={<XIcon size={22} strokeWidth={2} />}
      target={
        <AccessTarget user={user} subtitle={C.banner(request.creator.display_name, request.type)} />
      }
      consequence={C.rejectDialog.consequence}
      reason={{
        label: C.rejectDialog.reasonLabel,
        required: true,
        placeholder: C.rejectDialog.reasonPlaceholder,
        hint: C.rejectDialog.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={C.rejectDialog.confirm}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
