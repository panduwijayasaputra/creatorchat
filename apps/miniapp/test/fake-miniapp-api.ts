import type {
  CreatorLinkResponse,
  CreatorRequestStateResponse,
  CreatorSettingsResponse,
  SubmitCreatorRequest,
  SubmitCreatorRequestResponse,
  UpdateProfileRequest,
  UserProfile,
} from '@creatorchat/contracts';
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
  bio: null,
  telegram_avatar_url: null,
  timezone: 'Asia/Jakarta',
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
  updateProfileCalls: UpdateProfileRequest[];
  /** Next outcomes for getCreatorSettings; default is `maya` with a bot link. */
  creatorSettingsResults: (CreatorSettingsResponse | Error)[];
  creatorSettingsCalls: number;
  /** Inputs that went through the creator endpoint (also recorded in `updateProfileCalls`). */
  updateCreatorCalls: UpdateProfileRequest[];
  /** Zones sent to updateCreatorTimezone. */
  timezoneCalls: string[];
  /** Next outcomes for updateCreatorTimezone; default echoes the zone onto `maya`. */
  timezoneResults: (UserProfile | Error)[];
  /** Next outcomes for getCreatorRequestState; default is no request and no block. */
  creatorRequestStateResults: (CreatorRequestStateResponse | Error)[];
  creatorRequestStateCalls: number;
  /** Bodies sent to submitCreatorRequest, and its next outcomes (default: a PENDING request echoing the input). */
  submitRequestCalls: SubmitCreatorRequest[];
  submitRequestResults: (SubmitCreatorRequestResponse | Error)[];
  /** Next outcomes for updateProfile; default echoes the input onto `nadia`. */
  updateProfileResults: (UserProfile | Error)[];
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
    updateProfile?: (UserProfile | Error)[];
    creatorSettings?: (CreatorSettingsResponse | Error)[];
    timezone?: (UserProfile | Error)[];
    creatorRequestState?: (CreatorRequestStateResponse | Error)[];
    submitRequest?: (SubmitCreatorRequestResponse | Error)[];
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
    updateProfileCalls: [],
    updateProfileResults: [...(options.updateProfile ?? [])],
    creatorSettingsResults: [...(options.creatorSettings ?? [])],
    creatorSettingsCalls: 0,
    updateCreatorCalls: [],
    timezoneCalls: [],
    timezoneResults: [...(options.timezone ?? [])],
    creatorRequestStateResults: [...(options.creatorRequestState ?? [])],
    creatorRequestStateCalls: 0,
    submitRequestCalls: [],
    submitRequestResults: [...(options.submitRequest ?? [])],
    async getCreatorRequestState() {
      api.creatorRequestStateCalls += 1;
      const next = api.creatorRequestStateResults.shift() ?? { request: null, blocked: null };
      if (next instanceof Error) throw next;
      return next;
    },
    async submitCreatorRequest(input) {
      api.submitRequestCalls.push(input);
      const next = api.submitRequestResults.shift() ?? {
        request: {
          id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
          status: 'PENDING' as const,
          creator_name: input.creator_name.trim(),
          instagram_url: input.instagram_url.trim(),
          creator_type: input.creator_type,
          description: input.description.trim(),
          created_at: '2026-11-16T05:00:00.000Z',
          reviewed_at: null,
          review_reason: null,
        },
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async updateCreatorTimezone(timezone) {
      api.timezoneCalls.push(timezone);
      const next = api.timezoneResults.shift() ?? { ...maya, timezone };
      if (next instanceof Error) throw next;
      return next;
    },
    async getCreatorSettings() {
      api.creatorSettingsCalls += 1;
      const next = api.creatorSettingsResults.shift() ?? {
        profile: maya,
        public_code: 'salsa234',
        bio_link: 'https://t.me/TestBot?start=c_salsa234',
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async updateCreatorProfile(input) {
      api.updateCreatorCalls.push(input);
      api.updateProfileCalls.push(input);
      const next = api.updateProfileResults.shift() ?? {
        ...maya,
        display_name: input.display_name.trim(),
        bio: input.bio?.trim() || null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async updateProfile(input) {
      api.updateProfileCalls.push(input);
      const next = api.updateProfileResults.shift() ?? {
        ...nadia,
        display_name: input.display_name.trim(),
        bio: input.bio?.trim() || null,
      };
      if (next instanceof Error) throw next;
      return next;
    },
    async resolveCreator(code) {
      api.resolveCalls.push(code);
      const next = api.resolveResults.shift() ?? {
        public_code: code,
        display_name: 'Salsa',
        bio: null,
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
