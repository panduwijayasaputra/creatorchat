import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxFilter, InboxItem } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';
import { useLiveRefresh } from '../realtime/RealtimeProvider';

const PAGE = 30;

export type InboxState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: InboxItem[];
      nextCursor: string | null;
      unreadConversations: number;
      more: 'idle' | 'loading' | 'failed';
    };

type InboxApi = Pick<MiniappApi, 'getCreatorInbox'>;

/** Rows of a later page that the list already holds are dropped (a chat that moved to the top). */
const dedupe = (existing: InboxItem[], incoming: InboxItem[]) => {
  const seen = new Set(existing.map((i) => i.conversation_id));
  return incoming.filter((i) => !seen.has(i.conversation_id));
};

/**
 * The creator's inbox, page by page (keyset cursor from the server). A newer load (another filter,
 * retry, tab visible again) supersedes an older one, so a slow answer never overwrites a newer one.
 */
export function useInbox(api: InboxApi, filter: InboxFilter) {
  const [state, setState] = useState<InboxState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreBusy = useRef(false);

  const loadFirst = useCallback(
    (quiet: boolean) => {
      const mine = ++generation.current;
      moreBusy.current = false;
      if (!quiet) setState({ status: 'loading' });
      apiRef.current.getCreatorInbox({ filter, limit: PAGE }).then(
        (page) => {
          if (generation.current !== mine) return;
          setState({
            status: 'ready',
            items: page.items,
            nextCursor: page.next_cursor,
            unreadConversations: page.unread_conversations,
            more: 'idle',
          });
        },
        () => {
          // A quiet refetch keeps what is on screen.
          if (generation.current === mine && !quiet) setState({ status: 'error' });
        },
      );
    },
    [filter],
  );

  useEffect(() => {
    loadFirst(false);
    return () => {
      generation.current += 1;
    };
  }, [loadFirst, attempt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadFirst(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadFirst]);

  // Live (US-031): same quiet refetch as a visible tab.
  useLiveRefresh(() => {
    if (stateRef.current.status === 'ready') loadFirst(true);
  });

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (moreBusy.current || current.status !== 'ready' || current.nextCursor === null) return;
    moreBusy.current = true;
    const mine = generation.current;
    const cursor = current.nextCursor;
    setState((s) => (s.status === 'ready' ? { ...s, more: 'loading' } : s));
    apiRef.current.getCreatorInbox({ filter, cursor, limit: PAGE }).then(
      (page) => {
        moreBusy.current = false;
        if (generation.current !== mine) return;
        setState((s) =>
          s.status === 'ready'
            ? {
                ...s,
                items: [...s.items, ...dedupe(s.items, page.items)],
                nextCursor: page.next_cursor,
                unreadConversations: page.unread_conversations,
                more: 'idle',
              }
            : s,
        );
      },
      () => {
        moreBusy.current = false;
        if (generation.current === mine) {
          setState((s) => (s.status === 'ready' ? { ...s, more: 'failed' } : s));
        }
      },
    );
  }, [filter]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, loadMore, retry };
}
