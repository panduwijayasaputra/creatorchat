import { useEffect, useState } from 'react';
import type { SubscriptionRow } from '@creatorchat/contracts';
import { ConfirmDialog, StatusChip, UserSlashIcon } from '@creatorchat/ui';
import type { UserSubscriptionsApi } from '../../../auth/api-client';
import { formatDateWib } from '../../../creators/format';
import { ACCESS_COPY as C } from '../../copy';
import { AccessTarget, type AccessUser } from './AccessTarget';
import { checkReason, decide, type AccessDecision } from './access-decision';

export interface RevokeAccessDialogProps {
  user: AccessUser;
  row: SubscriptionRow;
  open: boolean;
  api: Pick<UserSubscriptionsApi, 'revokeAccess'>;
  onClose: () => void;
  onDecided: (decision: AccessDecision) => void;
}

/** `AdmDlgRevoke`: the access ends now; messages and the conversation are never touched. */
export function RevokeAccessDialog({
  user,
  row,
  open,
  api,
  onClose,
  onDecided,
}: RevokeAccessDialogProps) {
  const [failure, setFailure] = useState<string>(C.gap.failed);
  useEffect(() => {
    if (open) setFailure(C.gap.failed);
  }, [open]);

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(C.gap.failed);
    const checked = checkReason(reason);
    if (!checked.ok) {
      setFailure(checked.message);
      throw new Error('invalid reason');
    }
    onDecided(await decide(() => api.revokeAccess(user.id, row.id, checked.reason)));
  };

  return (
    <ConfirmDialog
      open={open}
      destructive
      width={560}
      top={110}
      title={C.revokeDialog.title}
      icon={<UserSlashIcon size={22} strokeWidth={2} />}
      target={
        <AccessTarget
          user={user}
          title={`${user.display_name} → ${row.creator.display_name}`}
          subtitle={C.extendDialog.activeUntil(formatDateWib(row.ends_at))}
          chip={<StatusChip status="active" />}
        />
      }
      consequence={
        <>
          {C.revokeDialog.before}
          <strong>{C.revokeDialog.strong}</strong>
          {C.revokeDialog.after}
        </>
      }
      reason={{
        label: C.revokeDialog.reasonLabel,
        required: true,
        hint: C.revokeDialog.reasonHint,
        requiredMessage: 'Alasan wajib diisi.',
      }}
      confirmLabel={C.revokeDialog.confirm}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
