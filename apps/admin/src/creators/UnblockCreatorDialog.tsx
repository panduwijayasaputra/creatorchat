import { useEffect, useState } from 'react';
import {
  CreatorStatusConflictDetailsSchema,
  ErrorCode,
  ModerateCreatorSchema,
  REJECT_REASON_REQUIRED,
  type CreatorListRow,
} from '@creatorchat/contracts';
import { ConfirmDialog, RefreshIcon } from '@creatorchat/ui';
import { ApiError, type CreatorModerationApi } from '../auth/api-client';
import { BLOCK_GAP_COPY, UNBLOCK_COPY } from './copy';
import { CreatorTarget } from './CreatorTarget';

export type UnblockDecision = { kind: 'unblocked' } | { kind: 'conflict' };

export interface UnblockCreatorDialogProps {
  row: CreatorListRow;
  open: boolean;
  api: Pick<CreatorModerationApi, 'unblockCreator'>;
  onClose: () => void;
  onDecided: (decision: UnblockDecision) => void;
}

/** `AdmDlgUnblock`. Restores the status only: no subscription is re-granted. */
export function UnblockCreatorDialog({
  row,
  open,
  api,
  onClose,
  onDecided,
}: UnblockCreatorDialogProps) {
  const [failure, setFailure] = useState<string>(BLOCK_GAP_COPY.failed);

  useEffect(() => {
    if (!open) setFailure(BLOCK_GAP_COPY.failed);
  }, [open]);

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(BLOCK_GAP_COPY.failed);
    const parsed = ModerateCreatorSchema.safeParse({ reason: reason ?? '' });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? REJECT_REASON_REQUIRED);
      throw new Error('invalid reason');
    }
    try {
      await api.unblockCreator(row.id, parsed.data.reason);
      onDecided({ kind: 'unblocked' });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === ErrorCode.CREATOR_STATUS_CONFLICT &&
        CreatorStatusConflictDetailsSchema.safeParse(error.details).success
      ) {
        onDecided({ kind: 'conflict' });
        return;
      }
      throw error;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={UNBLOCK_COPY.title}
      icon={<RefreshIcon size={22} strokeWidth={2} />}
      target={<CreatorTarget row={row} status="blocked" />}
      consequence={UNBLOCK_COPY.consequence}
      reason={{
        label: UNBLOCK_COPY.reasonLabel,
        required: true,
        placeholder: UNBLOCK_COPY.reasonPlaceholder,
        hint: UNBLOCK_COPY.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={UNBLOCK_COPY.confirm}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
