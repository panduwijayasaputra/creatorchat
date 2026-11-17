import { useEffect, useState } from 'react';
import {
  ErrorCode,
  ModerateUserSchema,
  REJECT_REASON_REQUIRED,
  UserRoleConflictDetailsSchema,
  UserStatusConflictDetailsSchema,
  type UserListRow,
} from '@creatorchat/contracts';
import { ConfirmDialog, RefreshIcon } from '@creatorchat/ui';
import { ApiError, type UserModerationApi } from '../auth/api-client';
import { USER_BLOCK_GAP_COPY, USER_UNBLOCK_COPY } from './copy';
import { UserTarget } from './UserTarget';

export type UnblockUserDecision = { kind: 'unblocked' } | { kind: 'conflict' };

export interface UnblockUserDialogProps {
  row: UserListRow;
  open: boolean;
  api: Pick<UserModerationApi, 'unblockUser'>;
  onClose: () => void;
  onDecided: (decision: UnblockUserDecision) => void;
}

/** `AdmDlgUserUnblock`. Restores the status only: no subscription is touched. */
export function UnblockUserDialog({ row, open, api, onClose, onDecided }: UnblockUserDialogProps) {
  const [failure, setFailure] = useState<string>(USER_BLOCK_GAP_COPY.failed);

  useEffect(() => {
    if (!open) setFailure(USER_BLOCK_GAP_COPY.failed);
  }, [open]);

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(USER_BLOCK_GAP_COPY.failed);
    const parsed = ModerateUserSchema.safeParse({ reason: reason ?? '' });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? REJECT_REASON_REQUIRED);
      throw new Error('invalid reason');
    }
    try {
      await api.unblockUser(row.id, parsed.data.reason);
      onDecided({ kind: 'unblocked' });
    } catch (error) {
      if (
        error instanceof ApiError &&
        ((error.code === ErrorCode.USER_STATUS_CONFLICT &&
          UserStatusConflictDetailsSchema.safeParse(error.details).success) ||
          (error.code === ErrorCode.USER_ROLE_CONFLICT &&
            UserRoleConflictDetailsSchema.safeParse(error.details).success))
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
      title={USER_UNBLOCK_COPY.title}
      icon={<RefreshIcon size={22} strokeWidth={2} />}
      target={<UserTarget row={row} status="blocked" />}
      consequence={USER_UNBLOCK_COPY.consequence}
      reason={{
        label: USER_UNBLOCK_COPY.reasonLabel,
        required: true,
        placeholder: USER_UNBLOCK_COPY.reasonPlaceholder,
        hint: USER_UNBLOCK_COPY.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={USER_UNBLOCK_COPY.confirm}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
