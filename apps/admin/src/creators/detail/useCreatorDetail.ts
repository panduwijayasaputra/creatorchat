import { useCallback, useEffect, useState } from 'react';
import type { CreatorDetail } from '@creatorchat/contracts';
import { ApiError, type CreatorDetailApi } from '../../auth/api-client';

export type CreatorDetailState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; detail: CreatorDetail };

/**
 * Loads a creator / request detail. A newer id (or an unmount) cancels the older call. `reload`
 * refetches quietly (the current detail stays on screen) after a decision.
 */
export function useCreatorDetail(
  api: Pick<CreatorDetailApi, 'getCreatorDetail'>,
  id: string,
): { state: CreatorDetailState; reload: () => void } {
  const [state, setState] = useState<CreatorDetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) =>
      current.status === 'ready' && current.detail.id === id ? current : { status: 'loading' },
    );
    api.getCreatorDetail(id, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) setState({ status: 'ready', detail: response.detail });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not_found' }
            : { status: 'error' },
        );
      },
    );
    return () => controller.abort();
  }, [api, id, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
