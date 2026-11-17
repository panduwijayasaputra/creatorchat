import { useEffect, useState } from 'react';
import {
  ErrorCode,
  ModerateUserSchema,
  REJECT_REASON_REQUIRED,
  UserRoleConflictDetailsSchema,
  UserStatusConflictDetailsSchema,
  type UserListRow,
} from '@creatorchat/contracts';
import { ConfirmDialog, UserSlashIcon } from '@creatorchat/ui';
import { ApiError, type UserModerationApi } from '../auth/api-client';
import styles from '../creators/review-dialog.module.css';
import { USER_BLOCK_COPY, USER_BLOCK_GAP_COPY } from './copy';
import { UserTarget } from './UserTarget';
import { useUserBlockCheck } from './useUserBlockCheck';

export type BlockUserDecision = { kind: 'blocked' } | { kind: 'conflict' };

export interface BlockUserDialogProps {
  /** A row of the user list (its `id` is the user id). */
  row: UserListRow;
  open: boolean;
  api: Pick<UserModerationApi, 'getUserBlockCheck' | 'blockUser'>;
  onClose: () => void;
  onDecided: (decision: BlockUserDecision) => void;
}

/** `AdmDlgUserBlock`. The reason is required here and on the server; the count is the live one. */
export function BlockUserDialog({ row, open, api, onClose, onDecided }: BlockUserDialogProps) {
  const { load, retry } = useUserBlockCheck(api, row.id, open);
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
      await api.blockUser(row.id, parsed.data.reason);
      onDecided({ kind: 'blocked' });
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

  let consequence: React.ReactNode = <div className={styles.skeleton} aria-hidden="true" />;
  if (load.status === 'failed') {
    consequence = (
      <div role="alert">
        {USER_BLOCK_GAP_COPY.loadFailed}
        <button type="button" className={styles.retry} onClick={retry}>
          {USER_BLOCK_GAP_COPY.retry}
        </button>
      </div>
    );
  } else if (load.status === 'ready') {
    const n = load.check.active_subscriptions;
    consequence = (
      <>
        {USER_BLOCK_COPY.intro}
        {n > 0 ? (
          <>
            {USER_BLOCK_COPY.before}
            <strong>{USER_BLOCK_COPY.count(n)}</strong>
            {USER_BLOCK_COPY.after}
          </>
        ) : null}
      </>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      destructive
      title={USER_BLOCK_COPY.title}
      icon={<UserSlashIcon size={22} strokeWidth={2} />}
      target={<UserTarget row={row} status="active" />}
      consequence={consequence}
      reason={{
        label: USER_BLOCK_COPY.reasonLabel,
        required: true,
        placeholder: USER_BLOCK_COPY.reasonPlaceholder,
        hint: USER_BLOCK_COPY.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={USER_BLOCK_COPY.confirm}
      confirmDisabled={load.status !== 'ready'}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
