import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserListQuery, UserListResponse } from '@creatorchat/contracts';
import type { UserListApi } from '../auth/api-client';

export type UserListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: UserListResponse };

/** Loads the list for a query; a newer query (or an unmount) cancels the older call. */
export function useUserList(
  api: UserListApi,
  query: UserListQuery,
): { state: UserListState; reload: () => void } {
  const [state, setState] = useState<UserListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.listUsers(queryRef.current, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [api, key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
