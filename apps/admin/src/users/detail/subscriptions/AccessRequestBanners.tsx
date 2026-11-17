import type { PendingAccessRequest } from '@creatorchat/contracts';
import { Button, HourglassIcon } from '@creatorchat/ui';
import { formatDateTimeWib } from '../../../creators/format';
import { ACCESS_REQUEST_COPY as C } from '../../copy';
import type { AccessRequestsState } from './useAccessRequests';
import styles from './subscriptions.module.css';

/**
 * One banner per pending trial / renewal request, above the Langganan table (US-024). DESIGN GAP:
 * no board; built from the existing note, button and chip pieces.
 */
export function AccessRequestBanners({
  state,
  blocked,
  onApprove,
  onReject,
  onRetry,
}: {
  state: AccessRequestsState;
  /** A BLOCKED account cannot be granted access; rejecting stays possible. */
  blocked: boolean;
  onApprove: (request: PendingAccessRequest) => void;
  onReject: (request: PendingAccessRequest) => void;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return (
      <div className={styles.requestBanner} role="alert">
        <span className={styles.requestText}>{C.loadFailed}</span>
        <button type="button" className={styles.retryLink} onClick={onRetry}>
          {C.retry}
        </button>
      </div>
    );
  }
  if (state.items.length === 0) return null;
  return (
    <div className={styles.requests} role="group" aria-label="Permintaan akses">
      {state.items.map((request) => (
        <div key={request.id} className={styles.requestBanner}>
          <span className={styles.requestIcon} aria-hidden="true">
            <HourglassIcon size={20} strokeWidth={2} />
          </span>
          <div className={styles.requestText}>
            <div className={styles.requestTitle}>
              {C.banner(request.creator.display_name, request.type)}
            </div>
            <div className={styles.requestMeta}>
              {C.sent} {formatDateTimeWib(request.requested_at)}
            </div>
          </div>
          <div className={styles.actions}>
            <Button
              size="table"
              aria-label={`${C.approve} permintaan akses ke ${request.creator.display_name}`}
              disabled={blocked}
              {...(blocked ? { title: C.approveBlocked } : {})}
              onClick={() => onApprove(request)}
            >
              {C.approve}
            </Button>
            <Button
              size="table"
              variant="outline"
              className={styles.danger}
              aria-label={`${C.reject} permintaan akses ke ${request.creator.display_name}`}
              onClick={() => onReject(request)}
            >
              {C.reject}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
