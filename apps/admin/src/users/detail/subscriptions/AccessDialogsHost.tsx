import type { SubscriptionRow } from '@creatorchat/contracts';
import { useToast } from '@creatorchat/ui';
import type { UserSubscriptionsApi } from '../../../auth/api-client';
import { formatDateWib } from '../../../creators/format';
import { ACCESS_COPY as C } from '../../copy';
import type { AccessUser } from './AccessTarget';
import type { AccessDecision } from './access-decision';
import { ExtendAccessDialog } from './ExtendAccessDialog';
import { GrantAccessDialog } from './GrantAccessDialog';
import { RevokeAccessDialog } from './RevokeAccessDialog';

export type AccessDialog =
  | { kind: 'grant'; row: SubscriptionRow }
  | { kind: 'extend'; row: SubscriptionRow }
  | { kind: 'revoke'; row: SubscriptionRow }
  | null;

/**
 * The three US-020 dialogs for one customer and subscription, with their toasts. The subscription
 * detail page and the creator's Subscriber tab host them; `onChanged` runs after every decision so
 * the host refetches (a 409 means the state moved, so it refetches too).
 */
export function AccessDialogsHost({
  user,
  dialog,
  api,
  onClose,
  onChanged,
}: {
  user: AccessUser;
  dialog: AccessDialog;
  api: UserSubscriptionsApi;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const decided = (decision: AccessDecision, message: (endsAt: string) => string) => {
    onClose();
    toast.show({
      message:
        decision.kind === 'done'
          ? message(decision.subscription.ends_at)
          : C.gap.conflictToast(user.display_name),
    });
    onChanged();
  };
  return (
    <>
      <GrantAccessDialog
        user={user}
        open={dialog?.kind === 'grant'}
        api={api}
        lockedCreator={dialog?.kind === 'grant' ? dialog.row.creator : undefined}
        onClose={onClose}
        onDecided={(decision, creator) =>
          decided(decision, (endsAt) =>
            C.grantedToast(user.display_name, creator, formatDateWib(endsAt)),
          )
        }
      />
      {dialog?.kind === 'extend' ? (
        <ExtendAccessDialog
          user={user}
          row={dialog.row}
          open
          api={api}
          onClose={onClose}
          onDecided={(decision) =>
            decided(decision, (endsAt) =>
              C.extendedToast(
                user.display_name,
                dialog.row.creator.display_name,
                formatDateWib(endsAt),
              ),
            )
          }
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeAccessDialog
          user={user}
          row={dialog.row}
          open
          api={api}
          onClose={onClose}
          onDecided={(decision) =>
            decided(decision, () =>
              C.revokedToast(user.display_name, dialog.row.creator.display_name),
            )
          }
        />
      ) : null}
    </>
  );
}
