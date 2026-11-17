import { useEffect, useMemo, useState } from 'react';
import { computeExtendedEnd, DEFAULT_DURATION, type SubscriptionRow } from '@creatorchat/contracts';
import { ChevronDownIcon, ClockIcon, ConfirmDialog, StatusChip } from '@creatorchat/ui';
import type { UserSubscriptionsApi } from '../../../auth/api-client';
import { formatDateWib } from '../../../creators/format';
import { ACCESS_COPY as C } from '../../copy';
import { AccessTarget, type AccessUser } from './AccessTarget';
import { checkReason, decide, type AccessDecision } from './access-decision';
import styles from './subscriptions.module.css';

export interface ExtendAccessDialogProps {
  user: AccessUser;
  row: SubscriptionRow;
  open: boolean;
  api: Pick<UserSubscriptionsApi, 'extendAccess'>;
  onClose: () => void;
  onDecided: (decision: AccessDecision) => void;
}

/** `AdmDlgExtend`. "Berakhir menjadi" is `computeExtendedEnd`, the same function the server uses. */
export function ExtendAccessDialog({
  user,
  row,
  open,
  api,
  onClose,
  onDecided,
}: ExtendAccessDialogProps) {
  const [days, setDays] = useState(String(DEFAULT_DURATION));
  const [failure, setFailure] = useState<string>(C.gap.failed);
  const now = useMemo(() => new Date(), [open]);

  useEffect(() => {
    if (open) {
      setDays(String(DEFAULT_DURATION));
      setFailure(C.gap.failed);
    }
  }, [open]);

  const endsAt = computeExtendedEnd(new Date(row.ends_at), now, Number(days));

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(C.gap.failed);
    const checked = checkReason(reason);
    if (!checked.ok) {
      setFailure(checked.message);
      throw new Error('invalid reason');
    }
    onDecided(
      await decide(() =>
        api.extendAccess(user.id, row.id, { duration_days: Number(days), reason: checked.reason }),
      ),
    );
  };

  return (
    <ConfirmDialog
      open={open}
      width={580}
      top={110}
      title={C.extendDialog.title}
      icon={<ClockIcon size={22} strokeWidth={2} />}
      target={
        <AccessTarget
          user={user}
          title={`${user.display_name} → ${row.creator.display_name}`}
          subtitle={C.extendDialog.activeUntil(formatDateWib(row.ends_at))}
          chip={<StatusChip status="active" />}
        />
      }
      consequence={
        <div className={styles.grid}>
          <div>
            <div className={styles.fieldLabel}>{C.extendDialog.addDuration}</div>
            <span className={styles.control}>
              <span>{C.durationOptions.find((o) => o.value === days)?.label}</span>
              <ChevronDownIcon size={16} strokeWidth={2} />
              <select
                className={styles.native}
                aria-label={C.extendDialog.addDuration}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                {C.durationOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div>
            <div className={styles.fieldLabel}>{C.extendDialog.endsAs}</div>
            <span className={`${styles.control} ${styles.readonly}`}>
              <span>{`${formatDateWib(endsAt.toISOString())}, 23.59 WIB`}</span>
            </span>
          </div>
        </div>
      }
      reason={{
        label: C.extendDialog.reasonLabel,
        required: true,
        hint: C.extendDialog.reasonHint,
        requiredMessage: 'Alasan wajib diisi.',
      }}
      afterReason={C.extendDialog.after}
      confirmLabel={C.extendDialog.confirm}
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
