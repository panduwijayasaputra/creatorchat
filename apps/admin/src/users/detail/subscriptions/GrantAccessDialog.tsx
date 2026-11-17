import { useEffect, useMemo, useState } from 'react';
import {
  computeEndDate,
  endOfJakartaDay,
  jakartaDateString,
  MAX_END_DAYS,
  DEFAULT_DURATION,
  type GrantableCreatorsResponse,
} from '@creatorchat/contracts';
import { CalendarIcon, ChevronDownIcon, ConfirmDialog, PlusIcon } from '@creatorchat/ui';
import type { SubscriptionDetailApi, UserSubscriptionsApi } from '../../../auth/api-client';
import { formatDateWib } from '../../../creators/format';
import { ACCESS_COPY as C } from '../../copy';
import { AccessTarget, type AccessUser } from './AccessTarget';
import { checkReason, decide, type AccessDecision } from './access-decision';
import { UserPicker } from './UserPicker';
import styles from './subscriptions.module.css';

const DAY = 86_400_000;
const CUSTOM = C.customOption.value;

type Creators =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; items: GrantableCreatorsResponse['items'] };

export interface GrantAccessDialogProps {
  /** The customer. Omitted when `picker` is given: the admin picks the user in the dialog. */
  user?: AccessUser | undefined;
  open: boolean;
  api: Pick<UserSubscriptionsApi, 'getGrantableCreators' | 'grantAccess'> &
    Partial<Pick<SubscriptionDetailApi, 'listGrantableUsers'>>;
  /** "Berikan Ulang": the creator is fixed to the row's creator. */
  lockedCreator?: { id: string; display_name: string } | undefined;
  /** US-024 "Setujui": the pending request this grant answers; the server closes it. */
  accessRequestId?: string | undefined;
  /** Creator side (US-021): the creator is fixed and the user comes from a server-side picker. */
  picker?: boolean | undefined;
  onClose: () => void;
  onDecided: (decision: AccessDecision, creatorName: string, user: AccessUser) => void;
}

/** `AdmDlgGrant`. The end date shown is `computeEndDate`, the same function the server uses. */
export function GrantAccessDialog({
  user: givenUser,
  open,
  api,
  lockedCreator,
  accessRequestId,
  picker,
  onClose,
  onDecided,
}: GrantAccessDialogProps) {
  const [picked, setPicked] = useState<AccessUser | null>(null);
  const user = picker ? picked : (givenUser ?? null);
  const [creators, setCreators] = useState<Creators>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [creatorId, setCreatorId] = useState('');
  const [mode, setMode] = useState(String(DEFAULT_DURATION));
  const [customDate, setCustomDate] = useState('');
  const [failure, setFailure] = useState<string>(C.gap.failed);
  // "Today" is fixed while the dialog is open, so the preview and the request agree.
  const now = useMemo(() => new Date(), [open]);

  // A new opening starts without a picked user (picking must not reset itself).
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMode(String(DEFAULT_DURATION));
    setCustomDate('');
    setFailure(C.gap.failed);
    if (lockedCreator) {
      setCreatorId(lockedCreator.id);
      setCreators({ status: 'ready', items: [{ ...lockedCreator, avatar_url: null }] });
      return;
    }
    let current = true;
    setCreators({ status: 'loading' });
    if (!user) return;
    api.getGrantableCreators(user.id).then(
      (result) => {
        if (!current) return;
        setCreators({ status: 'ready', items: result.items });
        setCreatorId(result.items[0]?.id ?? '');
      },
      () => {
        if (current) setCreators({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [api, user?.id, open, attempt, lockedCreator]);

  const minDate = jakartaDateString(new Date(now.getTime() + DAY));
  const maxDate = jakartaDateString(new Date(now.getTime() + MAX_END_DAYS * DAY));
  const custom = mode === CUSTOM;
  const endsAt = custom ? endOfJakartaDay(customDate) : computeEndDate(now, Number(mode));
  const dateOk = endsAt !== null && (!custom || (customDate >= minDate && customDate <= maxDate));
  const items = creators.status === 'ready' ? creators.items : [];
  const creatorName = items.find((c) => c.id === creatorId)?.display_name ?? '';

  const chooseDuration = (value: string) => {
    if (value === CUSTOM && !customDate && endsAt) setCustomDate(jakartaDateString(endsAt));
    setMode(value);
  };

  const confirm = async (reason?: string): Promise<void> => {
    setFailure(C.gap.failed);
    const checked = checkReason(reason);
    if (!checked.ok) {
      setFailure(checked.message);
      throw new Error('invalid reason');
    }
    if (!user) throw new Error('no user picked');
    const decision = await decide(() =>
      api.grantAccess(user.id, {
        creator_id: creatorId,
        reason: checked.reason,
        ...(accessRequestId ? { access_request_id: accessRequestId } : {}),
        ...(custom ? { end_date: customDate } : { duration_days: Number(mode) }),
      }),
    );
    onDecided(decision, creatorName, user);
  };

  let form: React.ReactNode;
  if (picker && !lockedCreator) {
    form = null;
  } else if (creators.status === 'loading') {
    form = <div className={styles.skeleton} role="status" aria-label={C.gap.loadingCreators} />;
  } else if (creators.status === 'failed') {
    form = (
      <div role="alert">
        {C.gap.creatorsFailed}
        <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
          {C.gap.retry}
        </button>
      </div>
    );
  } else if (items.length === 0) {
    form = <div>{C.gap.noCreators}</div>;
  } else {
    form = (
      <div className={styles.stack}>
        <div className={styles.grid}>
          <div>
            <div className={styles.fieldLabel}>{C.grantDialog.creator}</div>
            <span className={styles.control}>
              <span>{creatorName}</span>
              <ChevronDownIcon size={16} strokeWidth={2} />
              <select
                className={styles.native}
                aria-label={C.grantDialog.creator}
                value={creatorId}
                disabled={Boolean(lockedCreator)}
                onChange={(e) => setCreatorId(e.target.value)}
              >
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div>
            <div className={styles.fieldLabel}>{C.grantDialog.duration}</div>
            <span className={styles.control}>
              <span>
                {custom
                  ? C.customOption.label
                  : (C.durationOptions.find((o) => o.value === mode)?.label ?? '')}
              </span>
              <ChevronDownIcon size={16} strokeWidth={2} />
              <select
                className={styles.native}
                aria-label={C.grantDialog.duration}
                value={mode}
                onChange={(e) => chooseDuration(e.target.value)}
              >
                {[...C.durationOptions, C.customOption].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>{C.grantDialog.endDate}</div>
          <span className={styles.control}>
            <span>{endsAt ? `${formatDateWib(endsAt.toISOString())}, 23.59 WIB` : '–'}</span>
            <CalendarIcon size={16} strokeWidth={2} />
            <input
              type="date"
              className={styles.native}
              aria-label={C.grantDialog.endDate}
              min={minDate}
              max={maxDate}
              value={customDate || (endsAt ? jakartaDateString(endsAt) : '')}
              onChange={(e) => {
                if (!e.target.value) return;
                setCustomDate(e.target.value);
                setMode(CUSTOM);
              }}
            />
          </span>
          {custom && !dateOk ? (
            <div className={styles.error} role="alert">
              {C.gap.endDateInvalid}
            </div>
          ) : (
            <div className={styles.hint}>{C.grantDialog.endHint}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      width={580}
      top={110}
      title={C.grantDialog.title}
      icon={<PlusIcon size={22} strokeWidth={2} />}
      target={user ? <AccessTarget user={user} /> : <span>{C.picker.choose}</span>}
      consequence={
        <div className={styles.stack}>
          {picker && api.listGrantableUsers && lockedCreator ? (
            <UserPicker
              open={open}
              value={picked}
              onChange={setPicked}
              listUsers={(q, signal) =>
                (api.listGrantableUsers as NonNullable<typeof api.listGrantableUsers>)(
                  lockedCreator.id,
                  q,
                  signal,
                )
              }
            />
          ) : null}
          {form}
        </div>
      }
      reason={{
        label: C.grantDialog.reasonLabel,
        required: true,
        hint: C.grantDialog.reasonHint,
        requiredMessage: 'Alasan wajib diisi.',
      }}
      afterReason={C.grantDialog.after}
      confirmLabel={C.grantDialog.confirm}
      confirmDisabled={
        !user || creators.status !== 'ready' || items.length === 0 || !creatorId || !dateOk
      }
      failureMessage={failure}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
