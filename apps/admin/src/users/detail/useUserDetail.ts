import { useCallback, useEffect, useState } from 'react';
import type { UserDetailResponse } from '@creatorchat/contracts';
import { ApiError, type UserDetailApi } from '../../auth/api-client';

export type UserDetailState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; detail: UserDetailResponse };

/** Loads a user's detail; a newer id (or an unmount) cancels the older call. `reload` refetches quietly. */
export function useUserDetail(
  api: Pick<UserDetailApi, 'getUserDetail'>,
  id: string,
): { state: UserDetailState; reload: () => void } {
  const [state, setState] = useState<UserDetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) =>
      current.status === 'ready' && current.detail.role === 'USER' && current.detail.user.id === id
        ? current
        : { status: 'loading' },
    );
    api.getUserDetail(id, controller.signal).then(
      (detail) => {
        if (!controller.signal.aborted) setState({ status: 'ready', detail });
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
