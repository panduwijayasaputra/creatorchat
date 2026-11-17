import { useCallback, useEffect, useRef } from 'react';
import type { ThreadMessage, ThreadState } from './useChat';

/**
 * US-030: moves my read cursor up to the newest message of the other side that is on screen.
 * One request at a time; a newer value that arrived meanwhile goes out when the answer returns.
 * Only while the page is visible; a failure stays silent and the next merge or the tab becoming
 * visible tries again. Shared by the customer chat and the creator conversation.
 */
export function useMarkRead<M extends ThreadMessage>(
  state: ThreadState<M, unknown>,
  isTheirs: (message: M) => boolean,
  conversationId: string,
  mark: (conversationId: string, throughSeq: number) => Promise<unknown>,
): void {
  const newest =
    state.status === 'ready'
      ? state.messages.reduce((n, m) => (isTheirs(m) ? Math.max(n, m.seq) : n), 0)
      : 0;
  const newestRef = useRef(0);
  newestRef.current = newest;
  const acked = useRef({ id: conversationId, seq: 0 });
  const inFlight = useRef(false);
  const markRef = useRef(mark);
  markRef.current = mark;

  const run = useCallback(async () => {
    if (acked.current.id !== conversationId) acked.current = { id: conversationId, seq: 0 };
    if (inFlight.current || document.visibilityState !== 'visible') return;
    inFlight.current = true;
    try {
      while (newestRef.current > acked.current.seq && document.visibilityState === 'visible') {
        const target = newestRef.current;
        await markRef.current(conversationId, target);
        acked.current = { id: conversationId, seq: target };
      }
    } catch {
      // Silent: the next trigger retries.
    } finally {
      inFlight.current = false;
    }
  }, [conversationId]);

  useEffect(() => {
    if (newest > 0) void run();
  }, [newest, run]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [run]);
}
