import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessRequestsResponse } from '@creatorchat/contracts';
import type { UserSubscriptionsApi } from '../../../auth/api-client';

export type AccessRequestsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: AccessRequestsResponse['items'] };

/** The user's pending access requests (US-024), loaded once and refetched on demand. */
export function useAccessRequests(
  api: Pick<UserSubscriptionsApi, 'listAccessRequests'>,
  userId: string,
) {
  const [state, setState] = useState<AccessRequestsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const controller = new AbortController();
    apiRef.current.listAccessRequests(userId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', items: data.items });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [userId, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, refetch };
}
