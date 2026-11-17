import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  RealtimeEventSchemas,
  type RealtimeEventName,
  type RealtimeEvents,
} from '@creatorchat/contracts';
import type { MiniappApi } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import type { RealtimeConnection, RealtimeFactory } from './types';

/** `idle`: no connection is wanted (signed out, or realtime not configured). */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

type Signal = Exclude<RealtimeEventName, 'session.ended'>;
const SIGNALS: Signal[] = ['message.created', 'read.updated', 'conversation.updated'];

interface RealtimeContextValue {
  status: RealtimeStatus;
  /** True once a connection succeeded: later drops are "reconnecting", not "never connected". */
  hasConnected: boolean;
  subscribe<E extends Signal>(event: E, handler: (payload: RealtimeEvents[E]) => void): () => void;
  /** Called on every connect after the first one: the moment to catch up over HTTP. */
  onReconnect(handler: () => void): () => void;
}

const IDLE: RealtimeContextValue = {
  status: 'idle',
  hasConnected: false,
  subscribe: () => () => undefined,
  onReconnect: () => () => undefined,
};
const RealtimeContext = createContext<RealtimeContextValue>(IDLE);

export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;

/**
 * Keeps one socket open while a USER or CREATOR is signed in (US-031). Events are signals: they are
 * parsed with the contract schema (anything else is dropped) and handed to the screens, which refetch
 * over HTTP. A refused or ended session renews the token through the API client and retries with
 * backoff; Socket.IO retries network drops itself. Without a `factory` nothing connects.
 */
export function RealtimeProvider({
  api,
  factory,
  children,
}: {
  api: Pick<MiniappApi, 'getAccessToken' | 'renewAccessToken'>;
  factory?: RealtimeFactory | undefined;
  children: ReactNode;
}) {
  const { state } = useAuth();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  const role = state.status === 'authenticated' ? state.user.role : null;
  const wanted =
    userId !== null && (role === 'USER' || role === 'CREATOR') && factory !== undefined;

  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [hasConnected, setHasConnected] = useState(false);
  const handlers = useRef(new Map<string, Set<(payload: never) => void>>());
  const reconnects = useRef(new Set<() => void>());
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (!wanted || !factory) {
      setStatus('idle');
      setHasConnected(false);
      return;
    }
    let active = true;
    let everConnected = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const conn: RealtimeConnection = factory({ getToken: () => apiRef.current.getAccessToken() });
    setStatus('connecting');
    setHasConnected(false);

    /** The server refused or ended the session: renew the token, then try again, backing off. */
    const retryWithFreshToken = () => {
      if (!active || timer) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
      failures += 1;
      timer = setTimeout(() => {
        timer = undefined;
        void (async () => {
          try {
            const token = await apiRef.current.renewAccessToken();
            if (!active) return;
            if (token) conn.connect();
            // No token: the session is lost; the auth layer signs the person out.
          } catch {
            retryWithFreshToken(); // offline: the renewal itself failed
          }
        })();
      }, delay);
    };

    const onConnect = () => {
      failures = 0;
      setStatus('connected');
      setHasConnected(true);
      if (everConnected) reconnects.current.forEach((fn) => fn());
      everConnected = true;
    };
    const onDisconnect = (reason: unknown) => {
      setStatus('disconnected');
      // The server hung up (blocked, role changed, token expired): Socket.IO will not retry that.
      if (reason === 'io server disconnect') retryWithFreshToken();
    };
    const onConnectError = (error: unknown) => {
      setStatus(everConnected ? 'disconnected' : 'connecting');
      const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN_ROLE') retryWithFreshToken();
    };
    const dispatchers = SIGNALS.map((name) => {
      const fn = (raw: unknown) => {
        const parsed = RealtimeEventSchemas[name].safeParse(raw);
        if (!parsed.success) return;
        handlers.current.get(name)?.forEach((h) => h(parsed.data as never));
      };
      conn.on(name, fn);
      return [name, fn] as const;
    });
    conn.on('connect', onConnect);
    conn.on('disconnect', onDisconnect);
    conn.on('connect_error', onConnectError);
    conn.connect();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      conn.off('connect', onConnect);
      conn.off('disconnect', onDisconnect);
      conn.off('connect_error', onConnectError);
      dispatchers.forEach(([name, fn]) => conn.off(name, fn));
      conn.disconnect();
    };
  }, [wanted, userId, role, factory]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      hasConnected,
      subscribe: (event, handler) => {
        const set = handlers.current.get(event) ?? new Set();
        handlers.current.set(event, set);
        set.add(handler as (payload: never) => void);
        return () => void set.delete(handler as (payload: never) => void);
      },
      onReconnect: (handler) => {
        reconnects.current.add(handler);
        return () => void reconnects.current.delete(handler);
      },
    }),
    [status, hasConnected],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): { status: RealtimeStatus; hasConnected: boolean } {
  const { status, hasConnected } = useContext(RealtimeContext);
  return { status, hasConnected };
}

/** Runs `handler` for each valid event of that name while the component is mounted. */
export function useRealtimeEvent<E extends Signal>(
  event: E,
  handler: (payload: RealtimeEvents[E]) => void,
): void {
  const { subscribe } = useContext(RealtimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (payload) => ref.current(payload)), [subscribe, event]);
}

/** Runs `handler` after every reconnect (not the first connect). */
export function useReconnect(handler: () => void): void {
  const { onReconnect } = useContext(RealtimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onReconnect(() => ref.current()), [onReconnect]);
}

/** At most one live refetch per this long; a burst of signals leaves one trailing refetch. */
export const LIVE_REFRESH_MIN_MS = 2000;

/**
 * For list screens: calls `refresh` when any conversation changes (throttled, with a trailing call)
 * and straight away after a reconnect. `refresh` should fetch over HTTP and keep what is on screen
 * if that fails.
 */
export function useLiveRefresh(refresh: () => void, minIntervalMs = LIVE_REFRESH_MIN_MS): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    last.current = Date.now();
    ref.current();
  };
  useRealtimeEvent('conversation.updated', () => {
    const wait = minIntervalMs - (Date.now() - last.current);
    if (wait <= 0) run();
    else timer.current ??= setTimeout(run, wait);
  });
  useReconnect(run);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
