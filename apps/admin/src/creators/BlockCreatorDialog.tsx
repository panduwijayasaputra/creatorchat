import { useEffect, useState } from 'react';
import {
  CreatorStatusConflictDetailsSchema,
  ErrorCode,
  ModerateCreatorSchema,
  REJECT_REASON_REQUIRED,
  type CreatorListRow,
} from '@creatorchat/contracts';
import { ConfirmDialog, UserSlashIcon } from '@creatorchat/ui';
import { ApiError, type CreatorModerationApi } from '../auth/api-client';
import { BLOCK_COPY, BLOCK_GAP_COPY } from './copy';
import { CreatorTarget } from './CreatorTarget';
import styles from './review-dialog.module.css';
import { useBlockCheck } from './useBlockCheck';

export type BlockDecision = { kind: 'blocked' } | { kind: 'conflict' };

export interface BlockCreatorDialogProps {
  /** A creator account row of the list (its `id` is the creator id). */
  row: CreatorListRow;
  open: boolean;
  api: Pick<CreatorModerationApi, 'getBlockCheck' | 'blockCreator'>;
  onClose: () => void;
  onDecided: (decision: BlockDecision) => void;
}

/** `AdmDlgBlock`. The reason is required here and on the server; the count is the live one. */
export function BlockCreatorDialog({
  row,
  open,
  api,
  onClose,
  onDecided,
}: BlockCreatorDialogProps) {
  const { load, retry } = useBlockCheck(api, row.id, open);
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
      await api.blockCreator(row.id, parsed.data.reason);
      onDecided({ kind: 'blocked' });
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

  let consequence: React.ReactNode = <div className={styles.skeleton} aria-hidden="true" />;
  if (load.status === 'failed') {
    consequence = (
      <div role="alert">
        {BLOCK_GAP_COPY.loadFailed}
        <button type="button" className={styles.retry} onClick={retry}>
          {BLOCK_GAP_COPY.retry}
        </button>
      </div>
    );
  } else if (load.status === 'ready') {
    consequence = (
      <>
        {BLOCK_COPY.before}
        <strong>{BLOCK_COPY.count(load.check.active_subscribers)}</strong>
        {BLOCK_COPY.after}
      </>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      destructive
      title={BLOCK_COPY.title}
      icon={<UserSlashIcon size={22} strokeWidth={2} />}
      target={<CreatorTarget row={row} status="active" />}
      consequence={consequence}
      reason={{
        label: BLOCK_COPY.reasonLabel,
        required: true,
        placeholder: BLOCK_COPY.reasonPlaceholder,
        hint: BLOCK_COPY.reasonHint,
        requiredMessage: REJECT_REASON_REQUIRED,
      }}
      confirmLabel={BLOCK_COPY.confirm}
      confirmDisabled={load.status !== 'ready'}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
