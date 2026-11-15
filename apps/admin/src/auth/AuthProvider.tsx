import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AdminLoginRequest, AdminProfile } from '@creatorchat/contracts';
import { createAdminApi, type AdminApi } from './api-client';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; admin: AdminProfile }
  | { status: 'anonymous' };

export interface AuthContextValue {
  state: AuthState;
  /** Throws `ApiError` (wrong credentials, locked, ...) or `NetworkError`; state changes on success only. */
  login(input: AdminLoginRequest): Promise<void>;
  /** Throws when the server could not be reached or refused; the caller shows its own message. */
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let defaultApi: AdminApi | undefined;
function getDefaultApi(): AdminApi {
  defaultApi ??= createAdminApi();
  return defaultApi;
}

/**
 * Holds `{status, admin}` in memory only: nothing is written to localStorage/sessionStorage, and
 * every page load asks the server (`/me`, which renews the session if it can).
 */
export function AuthProvider({ api, children }: { api?: AdminApi; children: ReactNode }) {
  const client = api ?? getDefaultApi();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const unsubscribe = client.onSessionLost(() => {
      if (active) setState({ status: 'anonymous' });
    });
    client.me().then(
      (admin) => {
        if (active) setState({ status: 'authenticated', admin });
      },
      () => {
        // 401 = signed out. Anything else (offline, 5xx) also lands on the login screen, which
        // reports connection problems itself when the person tries to sign in.
        if (active) setState({ status: 'anonymous' });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const login = useCallback(
    async (input: AdminLoginRequest) => {
      const admin = await client.login(input);
      setState({ status: 'authenticated', admin });
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setState({ status: 'anonymous' });
  }, [client]);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
