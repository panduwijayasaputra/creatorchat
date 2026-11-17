import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatorListQuery, CreatorListResponse } from '@creatorchat/contracts';
import type { CreatorListApi } from '../auth/api-client';

export type CreatorListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CreatorListResponse };

/**
 * Loads the list for a query. A newer query (or an unmount) cancels the older call, so a slow answer
 * can never overwrite a newer one. `reload` fetches the same query again (after a decision).
 */
export function useCreatorList(
  api: CreatorListApi,
  query: CreatorListQuery,
): { state: CreatorListState; reload: () => void } {
  const [state, setState] = useState<CreatorListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.listCreators(queryRef.current, controller.signal).then(
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
