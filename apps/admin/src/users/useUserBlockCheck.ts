import { useCallback, useEffect, useState } from 'react';
import type { UserBlockCheckResponse } from '@creatorchat/contracts';
import type { UserModerationApi } from '../auth/api-client';

export type UserBlockCheckLoad =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; check: UserBlockCheckResponse };

/** Loads the live subscription count each time the block dialog opens; `retry` loads it again. */
export function useUserBlockCheck(
  api: Pick<UserModerationApi, 'getUserBlockCheck'>,
  userId: string,
  open: boolean,
): { load: UserBlockCheckLoad; retry: () => void } {
  const [load, setLoad] = useState<UserBlockCheckLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ status: 'loading' });
    api.getUserBlockCheck(userId).then(
      (check) => {
        if (current) setLoad({ status: 'ready', check });
      },
      () => {
        if (current) setLoad({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [api, userId, open, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, retry };
}
