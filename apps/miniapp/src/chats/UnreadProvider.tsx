import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { useLiveRefresh } from '../realtime/RealtimeProvider';

/** A route change refreshes the count at most this often; becoming visible always does. */
export const UNREAD_THROTTLE_MS = 5000;

const UnreadContext = createContext<number | undefined>(undefined);

/** The unread count for the bottom navigation badge (customer: messages, creator: conversations); `undefined` until the first answer. */
export function useUnread(): number | undefined {
  return useContext(UnreadContext);
}

/**
 * Holds the unread count for the bottom navigation: a customer's total of unread messages (US-027)
 * or a creator's number of conversations with unread customer messages (US-030). Fetched on mount,
 * on route change (throttled) and when the tab becomes visible. A failure keeps the last value.
 * Live signals (US-031) refresh it too.
 */
export function UnreadProvider({
  api,
  children,
}: {
  api: Pick<MiniappApi, 'getChatUnread' | 'getCreatorUnread'>;
  children: ReactNode;
}) {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const role = state.status === 'authenticated' ? state.user.role : null;
  const isMember = role === 'USER' || role === 'CREATOR';
  const isCreator = role === 'CREATOR';
  const [total, setTotal] = useState<number | undefined>(undefined);
  const lastFetch = useRef(0);
  const generation = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(
    (force: boolean) => {
      if (!isMember) return;
      const now = Date.now();
      if (!force && now - lastFetch.current < UNREAD_THROTTLE_MS) return;
      lastFetch.current = now;
      const mine = ++generation.current;
      const request = isCreator
        ? apiRef.current.getCreatorUnread().then((data) => data.unread_conversations)
        : apiRef.current.getChatUnread().then((data) => data.unread_total);
      request.then(
        (count) => {
          if (generation.current === mine) setTotal(count);
        },
        () => undefined, // keep the last value
      );
    },
    [isMember, isCreator],
  );

  // Signed out: forget any count and fetch nothing.
  useEffect(() => {
    if (!isMember) {
      generation.current += 1;
      lastFetch.current = 0;
      setTotal(undefined);
    }
  }, [isMember]);

  useEffect(() => refresh(false), [pathname, refresh]);

  // Live (US-031): any conversation change or a reconnect refreshes the badge.
  useLiveRefresh(() => refresh(true));

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      generation.current += 1;
    };
  }, [refresh]);

  return <UnreadContext.Provider value={total}>{children}</UnreadContext.Provider>;
}
