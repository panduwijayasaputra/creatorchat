import type { AdminProfile } from '@creatorchat/contracts';
import { vi } from 'vitest';
import type { AdminApi } from '../src/auth/api-client';

export const TEST_ADMIN: AdminProfile = {
  id: '3f2b8c1e-5d4a-4b7e-9c1a-2d3e4f5a6b7c',
  username: 'admin',
  role: 'Administrator',
};

export interface FakeAdminApi extends AdminApi {
  login: ReturnType<typeof vi.fn<AdminApi['login']>>;
  me: ReturnType<typeof vi.fn<AdminApi['me']>>;
  logout: ReturnType<typeof vi.fn<AdminApi['logout']>>;
  /** Simulates the client reporting that the session can no longer be renewed. */
  loseSession(): void;
}

/** An in-memory `AdminApi`. By default the admin is already signed in. */
export function createFakeAdminApi(
  overrides: Partial<Pick<AdminApi, 'login' | 'me' | 'logout'>> = {},
): FakeAdminApi {
  const listeners = new Set<() => void>();
  return {
    login: vi.fn(overrides.login ?? (async () => TEST_ADMIN)),
    me: vi.fn(overrides.me ?? (async () => TEST_ADMIN)),
    logout: vi.fn(overrides.logout ?? (async () => undefined)),
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loseSession() {
      listeners.forEach((listener) => listener());
    },
  };
}
