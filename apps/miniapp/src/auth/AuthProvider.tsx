import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { TELEGRAM_SEEN_FLAG, type UserProfile } from '@creatorchat/contracts';
import { browserTelegram, type TelegramEnv } from '../telegram/webapp';
import { lossReasonFor, NetworkError, type MiniappApi } from './api-client';

export type AuthErrorKind = 'network' | 'expired' | 'blocked' | 'unavailable';

export type AuthState =
  | { status: 'connecting' }
  /** Inside Telegram, first launch on this device: show "Lanjutkan dengan Telegram". */
  | { status: 'login-required' }
  | { status: 'outside-telegram' }
  | { status: 'authenticated'; user: UserProfile }
  | { status: 'error'; kind: AuthErrorKind };

export interface AuthContextValue {
  state: AuthState;
  /** The "Lanjutkan dengan Telegram" button. */
  continueWithTelegram(): void;
  /** "Coba Lagi": reads initData again and retries the login. */
  retry(): void;
}

/** A device hint that this person logged in before (never a token). Failures read as "no". */
export interface SeenFlag {
  get(): boolean;
  set(): void;
}

export const browserSeenFlag: SeenFlag = {
  get() {
    try {
      return window.localStorage.getItem(TELEGRAM_SEEN_FLAG) === '1';
    } catch {
      return false;
    }
  },
  set() {
    try {
      window.localStorage.setItem(TELEGRAM_SEEN_FLAG, '1');
    } catch {
      // Storage may be blocked inside a WebView; the hint is only cosmetic.
    }
  },
};

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  api: MiniappApi;
  telegram?: TelegramEnv;
  seen?: SeenFlag;
  children: ReactNode;
}

function errorKindFor(error: unknown): AuthErrorKind {
  if (error instanceof NetworkError) return 'network';
  return lossReasonFor(error);
}

/**
 * Holds the login state in memory only. The access token never leaves the API client's closure;
 * on every launch initData is exchanged again, and the role comes from `/me`, never from the client.
 */
export function AuthProvider({
  api,
  telegram = browserTelegram,
  seen = browserSeenFlag,
  children,
}: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({ status: 'connecting' });
  const attempt = useRef(0);

  const connect = useCallback(
    async (initData: string) => {
      const id = ++attempt.current;
      setState({ status: 'connecting' });
      try {
        await api.loginWithTelegram(initData);
        // Role and status are read from the server; the login body is not used for routing.
        const user = await api.me();
        if (attempt.current !== id) return;
        seen.set();
        setState({ status: 'authenticated', user });
      } catch (error) {
        if (attempt.current !== id) return;
        setState({ status: 'error', kind: errorKindFor(error) });
      }
    },
    [api, seen],
  );

  useEffect(() => {
    telegram.signalReady();
    const initData = telegram.getInitData();
    if (initData === null) {
      setState({ status: 'outside-telegram' });
    } else if (seen.get()) {
      void connect(initData);
    } else {
      setState({ status: 'login-required' });
    }
    const unsubscribe = api.onSessionLost((reason) => {
      attempt.current += 1;
      setState({ status: 'error', kind: reason });
    });
    // A silent re-exchange can bring a different role (e.g. approved as creator): follow the server.
    const unsubscribeRenewed = api.onSessionRenewed((user) => {
      setState((current) =>
        current.status === 'authenticated' ? { status: 'authenticated', user } : current,
      );
    });
    return () => {
      attempt.current += 1;
      unsubscribe();
      unsubscribeRenewed();
    };
  }, [api, telegram, seen, connect]);

  const continueWithTelegram = useCallback(() => {
    const initData = telegram.getInitData();
    if (initData === null) setState({ status: 'outside-telegram' });
    else void connect(initData);
  }, [telegram, connect]);

  const value = useMemo(
    () => ({ state, continueWithTelegram, retry: continueWithTelegram }),
    [state, continueWithTelegram],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
