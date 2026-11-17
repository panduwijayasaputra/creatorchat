import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicMediaItem } from '@creatorchat/contracts';
import { ApiError, type MiniappApi } from '../auth/api-client';

const PAGE = 30;

export type CustomerGalleryState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: PublicMediaItem[];
      total: number;
      nextCursor: string | null;
      more: 'idle' | 'loading' | 'failed';
    };

/**
 * A creator's gallery for a customer, page by page. The caller only mounts it for an ACTIVE profile;
 * the server checks access on every call anyway, and a 403 means access ended: `onAccessLost`
 * lets the page refetch the profile, which then shows the locked panel.
 */
export function useCustomerGallery(
  api: Pick<MiniappApi, 'getCustomerGallery'>,
  publicCode: string,
  onAccessLost: () => void,
) {
  const [state, setState] = useState<CustomerGalleryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const lostRef = useRef(onAccessLost);
  lostRef.current = onAccessLost;
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreBusy = useRef(false);

  const lost = (error: unknown) =>
    error instanceof ApiError && error.code === 'GALLERY_ACCESS_REQUIRED';

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.getCustomerGallery(publicCode, { limit: PAGE }).then(
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
      (error: unknown) => {
        if (generation.current !== mine) return;
        if (lost(error)) lostRef.current();
        else setState({ status: 'error' });
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [publicCode, attempt]);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (moreBusy.current || current.status !== 'ready' || current.nextCursor === null) return;
    moreBusy.current = true;
    const mine = generation.current;
    setState((s) => (s.status === 'ready' ? { ...s, more: 'loading' } : s));
    try {
      const page = await apiRef.current.getCustomerGallery(publicCode, {
        cursor: current.nextCursor,
        limit: PAGE,
      });
      if (generation.current !== mine) return;
      setState((s) => {
        if (s.status !== 'ready') return s;
        const have = new Set(s.items.map((i) => i.id));
        return {
          ...s,
          items: [...s.items, ...page.items.filter((i) => !have.has(i.id))],
          total: page.total,
          nextCursor: page.next_cursor,
          more: 'idle',
        };
      });
    } catch (error) {
      if (generation.current !== mine) return;
      if (lost(error)) lostRef.current();
      else setState((s) => (s.status === 'ready' ? { ...s, more: 'failed' } : s));
    } finally {
      moreBusy.current = false;
    }
  }, [publicCode]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, loadMore, retry };
}
