import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExploreItem } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';

const PAGE_SIZE = 20;

export type ExploreState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: ExploreItem[];
      total: number;
      page: number;
      more: 'idle' | 'loading' | 'failed';
    };

/**
 * Loads Explore page by page (the server paginates). A newer load (retry, remount) supersedes an
 * older one, so a slow answer never overwrites a newer one.
 */
export function useExplore(api: Pick<MiniappApi, 'listCreators'>): {
  state: ExploreState;
  retry: () => void;
  loadMore: () => void;
} {
  const [state, setState] = useState<ExploreState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.listCreators({ page: 1, page_size: PAGE_SIZE }).then(
      (data) => {
        if (generation.current !== mine) return;
        setState({ status: 'ready', items: data.items, total: data.total, page: 1, more: 'idle' });
      },
      () => {
        if (generation.current === mine) setState({ status: 'error' });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [attempt]);

  const loadMore = useCallback(() => {
    setState((current) => {
      if (current.status !== 'ready' || current.more === 'loading') return current;
      const mine = generation.current;
      const next = current.page + 1;
      apiRef.current.listCreators({ page: next, page_size: PAGE_SIZE }).then(
        (data) => {
          if (generation.current !== mine) return;
          setState((s) =>
            s.status === 'ready'
              ? {
                  ...s,
                  items: [...s.items, ...data.items],
                  total: data.total,
                  page: next,
                  more: 'idle',
                }
              : s,
          );
        },
        () => {
          if (generation.current === mine) {
            setState((s) => (s.status === 'ready' ? { ...s, more: 'failed' } : s));
          }
        },
      );
      return { ...current, more: 'loading' };
    });
  }, []);

  return { state, retry: () => setAttempt((n) => n + 1), loadMore };
}
