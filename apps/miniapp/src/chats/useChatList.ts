import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatListItem } from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';
import { useLiveRefresh } from '../realtime/RealtimeProvider';

const PAGE_SIZE = 20;

export type ChatListState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: ChatListItem[];
      nextCursor: string | null;
      more: 'idle' | 'loading' | 'failed';
    };

/**
 * Loads the chat list page by page (keyset cursor). A newer load (retry, remount) supersedes an
 * older one, so a slow answer never overwrites a newer one; a failed "load more" keeps the rows.
 */
export function useChatList(api: Pick<MiniappApi, 'listChats'>) {
  const [state, setState] = useState<ChatListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const mine = ++generation.current;
    setState({ status: 'loading' });
    apiRef.current.listChats({ limit: PAGE_SIZE }).then(
      (data) => {
        if (generation.current !== mine) return;
        setState({
          status: 'ready',
          items: data.items,
          nextCursor: data.next_cursor,
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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Live (US-031): a conversation changed or the socket reconnected. Page 1 replaces the list; a
  // failure keeps the rows on screen.
  useLiveRefresh(() => {
    if (stateRef.current.status !== 'ready') return;
    const mine = ++generation.current;
    apiRef.current.listChats({ limit: PAGE_SIZE }).then(
      (data) => {
        if (generation.current !== mine) return;
        setState({
          status: 'ready',
          items: data.items,
          nextCursor: data.next_cursor,
          more: 'idle',
        });
      },
      () => undefined,
    );
  });

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'ready' || !current.nextCursor || current.more === 'loading') return;
    const mine = generation.current;
    setState({ ...current, more: 'loading' });
    apiRef.current.listChats({ limit: PAGE_SIZE, cursor: current.nextCursor }).then(
      (data) => {
        if (generation.current !== mine) return;
        setState((latest) => {
          if (latest.status !== 'ready') return latest;
          const known = new Set(latest.items.map((i) => i.conversation_id));
          return {
            status: 'ready',
            items: [...latest.items, ...data.items.filter((i) => !known.has(i.conversation_id))],
            nextCursor: data.next_cursor,
            more: 'idle',
          };
        });
      },
      () => {
        if (generation.current !== mine) return;
        setState((latest) => (latest.status === 'ready' ? { ...latest, more: 'failed' } : latest));
      },
    );
  }, []);

  return { state, retry, loadMore };
}
