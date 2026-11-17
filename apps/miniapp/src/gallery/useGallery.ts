import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatorGalleryItem, MediaAssetView } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';

const PAGE = 30;

export type GalleryState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      /** Newest first. */
      items: CreatorGalleryItem[];
      total: number;
      nextCursor: string | null;
      more: 'idle' | 'loading' | 'failed';
    };

type GalleryApi = Pick<MiniappApi, 'getGallery'>;

/**
 * My gallery, page by page. A newer load supersedes an older one. An item that was just uploaded is
 * added at the top at once ("Baru") and stays marked until the page is left.
 */
export function useGallery(api: GalleryApi) {
  const [state, setState] = useState<GalleryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreBusy = useRef(false);

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.getGallery({ limit: PAGE }).then(
      (page) => {
        if (generation.current !== mine) return;
        setState({
          status: 'ready',
          items: page.items,
          total: page.total,
          nextCursor: page.next_cursor,
          more: 'idle',
        });
      },
      () => {
        if (generation.current === mine) setState({ status: 'error' });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [attempt]);

  /** Fresh first page without the loading skeleton (thumbnail links expired). Keeps what is shown on failure. */
  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const page = await apiRef.current.getGallery({ limit: PAGE });
      if (generation.current !== mine) return;
      setState({
        status: 'ready',
        items: page.items,
        total: page.total,
        nextCursor: page.next_cursor,
        more: 'idle',
      });
    } catch {
      // The next trigger tries again.
    }
  }, []);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (moreBusy.current || current.status !== 'ready' || current.nextCursor === null) return;
    moreBusy.current = true;
    const mine = generation.current;
    setState((s) => (s.status === 'ready' ? { ...s, more: 'loading' } : s));
    try {
      const page = await apiRef.current.getGallery({ cursor: current.nextCursor, limit: PAGE });
      if (generation.current !== mine) return;
      setState((s) => {
        if (s.status !== 'ready') return s;
        const have = new Set(s.items.map((i) => i.asset.id));
        return {
          ...s,
          items: [...s.items, ...page.items.filter((i) => !have.has(i.asset.id))],
          total: page.total,
          nextCursor: page.next_cursor,
          more: 'idle',
        };
      });
    } catch {
      if (generation.current === mine) {
        setState((s) => (s.status === 'ready' ? { ...s, more: 'failed' } : s));
      }
    } finally {
      moreBusy.current = false;
    }
  }, []);

  /** An upload finished: show it at the top as "Baru" and count it. */
  const prepend = useCallback((asset: MediaAssetView) => {
    setFresh((f) => new Set(f).add(asset.id));
    setState((s) => {
      if (s.status !== 'ready' || s.items.some((i) => i.asset.id === asset.id)) return s;
      return {
        ...s,
        items: [{ asset, added_at: asset.created_at }, ...s.items],
        total: s.total + 1,
      };
    });
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, fresh, refresh, loadMore, prepend, retry };
}
