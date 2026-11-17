import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubscriptionItem } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';

export type SubscriptionsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: SubscriptionItem[] };

/**
 * Loads the customer's own creators. A newer load (retry, refetch after a request) supersedes an
 * older one, so a slow answer never overwrites a newer one. `refetch` keeps the list on screen
 * while it runs (no loading flash) and keeps the old list when it fails.
 */
export function useSubscriptions(api: Pick<MiniappApi, 'listSubscriptions'>) {
  const [state, setState] = useState<SubscriptionsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.listSubscriptions().then(
      (data) => {
        if (generation.current === mine) setState({ status: 'ready', items: data.items });
      },
      () => {
        if (generation.current === mine) setState({ status: 'error' });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const refetch = useCallback(async (): Promise<boolean> => {
    const mine = ++generation.current;
    try {
      const data = await apiRef.current.listSubscriptions();
      if (generation.current !== mine) return true;
      setState({ status: 'ready', items: data.items });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { state, retry, refetch };
}
