import { useCallback, useEffect, useState } from 'react';
import type { CreatorRequestReviewResponse } from '@creatorchat/contracts';
import type { CreatorReviewApi } from '../auth/api-client';

export type ReviewLoad =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; view: CreatorRequestReviewResponse };

/** Loads the request and its pre-check each time the dialog opens; `retry` loads it again. */
export function useRequestReview(
  api: Pick<CreatorReviewApi, 'getCreatorRequest'>,
  requestId: string,
  open: boolean,
): { load: ReviewLoad; retry: () => void } {
  const [load, setLoad] = useState<ReviewLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoad({ status: 'loading' });
    api.getCreatorRequest(requestId).then(
      (view) => {
        if (current) setLoad({ status: 'ready', view });
      },
      () => {
        if (current) setLoad({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [api, requestId, open, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, retry };
}
