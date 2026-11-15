import type { CreatorLinkResponse, UserProfile } from '@creatorchat/contracts';
import type { SeenFlag } from '../src/auth/AuthProvider';
import {
  ApiError,
  NetworkError,
  type MiniappApi,
  type SessionLossReason,
} from '../src/auth/api-client';
import type { TelegramEnv } from '../src/telegram/webapp';

export const nadia: UserProfile = {
  id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
  telegram_id: '424242',
  role: 'USER',
  status: 'ACTIVE',
  display_name: 'Nadia Putri',
  telegram_username: 'nadia',
  avatar_url: null,
};

export const maya: UserProfile = {
  ...nadia,
  id: '9c1f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e22',
  role: 'CREATOR',
};

export interface FakeMiniappApi extends MiniappApi {
  loginCalls: string[];
  meCalls: number;
  /** Next outcomes, consumed in order; default is success. */
  loginResults: (UserProfile | Error)[];
  meResults: (UserProfile | Error)[];
  loseSession(reason: SessionLossReason): void;
  /** Simulates a silent re-exchange that succeeded and returned this account. */
  renewSession(user: UserProfile): void;
  resolveCalls: string[];
  /** Next outcomes for resolveCreator, consumed in order; default is a creator named Salsa. */
  resolveResults: (CreatorLinkResponse | Error)[];
}

/**
 * In-memory API double. `login` answers with `loginResults` and `me` with `meResults`; `me` is the
 * source of the role, so tests can make the login body and `/me` disagree.
 */
export function createFakeMiniappApi(
  options: {
    login?: (UserProfile | Error)[];
    me?: (UserProfile | Error)[];
    resolve?: (CreatorLinkResponse | Error)[];
  } = {},
): FakeMiniappApi {
  const listeners = new Set<(reason: SessionLossReason) => void>();
  const renewed = new Set<(user: UserProfile) => void>();
  const api: FakeMiniappApi = {
    loginCalls: [],
    meCalls: 0,
    loginResults: [...(options.login ?? [])],
    meResults: [...(options.me ?? [])],
    resolveCalls: [],
    resolveResults: [...(options.resolve ?? [])],
    async resolveCreator(code) {
      api.resolveCalls.push(code);
      const next = api.resolveResults.shift() ?? {
        public_code: code,
        display_name: 'Salsa',
        avatar_url: null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async loginWithTelegram(initData) {
      api.loginCalls.push(initData);
      const next = api.loginResults.shift() ?? nadia;
      if (next instanceof Error) throw next;
      return next;
    },
    async me() {
      api.meCalls += 1;
      const next = api.meResults.shift() ?? nadia;
      if (next instanceof Error) throw next;
      return next;
    },
    onSessionLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onSessionRenewed(listener) {
      renewed.add(listener);
      return () => {
        renewed.delete(listener);
      };
    },
    renewSession(user) {
      renewed.forEach((listener) => listener(user));
    },
    loseSession(reason) {
      listeners.forEach((listener) => listener(reason));
    },
  };
  return api;
}

export const apiError = (status: number, code: ApiError['code']) =>
  new ApiError(status, code, 'error');
export const networkError = () => new NetworkError();

export function fakeTelegram(initData: string | null): TelegramEnv & { readyCalls: number } {
  const env = {
    readyCalls: 0,
    getInitData: () => initData,
    signalReady: () => {
      env.readyCalls += 1;
    },
  };
  return env;
}

export function fakeSeen(initial = false): SeenFlag & { value: boolean } {
  const flag = {
    value: initial,
    get: () => flag.value,
    set: () => {
      flag.value = true;
    },
  };
  return flag;
}
