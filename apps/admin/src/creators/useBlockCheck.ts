import { useCallback, useEffect, useState } from 'react';
import type { CreatorBlockCheckResponse } from '@creatorchat/contracts';
import type { CreatorModerationApi } from '../auth/api-client';

export type BlockCheckLoad =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; check: CreatorBlockCheckResponse };

/** Loads the live subscriber count each time the block dialog opens; `retry` loads it again. */
export function useBlockCheck(
  api: Pick<CreatorModerationApi, 'getBlockCheck'>,
  creatorId: string,
  open: boolean,
): { load: BlockCheckLoad; retry: () => void } {
  const [load, setLoad] = useState<BlockCheckLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ status: 'loading' });
    api.getBlockCheck(creatorId).then(
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
  }, [api, creatorId, open, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, retry };
}
