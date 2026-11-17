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
  getCreatorRequest: ReturnType<typeof vi.fn<AdminApi['getCreatorRequest']>>;
  approveCreatorRequest: ReturnType<typeof vi.fn<AdminApi['approveCreatorRequest']>>;
  rejectCreatorRequest: ReturnType<typeof vi.fn<AdminApi['rejectCreatorRequest']>>;
  listCreators: ReturnType<typeof vi.fn<AdminApi['listCreators']>>;
  listUsers: ReturnType<typeof vi.fn<AdminApi['listUsers']>>;
  getCreatorDetail: ReturnType<typeof vi.fn<AdminApi['getCreatorDetail']>>;
  listCreatorHistory: ReturnType<typeof vi.fn<AdminApi['listCreatorHistory']>>;
  getAuditLog: ReturnType<typeof vi.fn<AdminApi['getAuditLog']>>;
  getSubscription: ReturnType<typeof vi.fn<AdminApi['getSubscription']>>;
  listSubscriptionEvents: ReturnType<typeof vi.fn<AdminApi['listSubscriptionEvents']>>;
  listCreatorSubscribers: ReturnType<typeof vi.fn<AdminApi['listCreatorSubscribers']>>;
  listGrantableUsers: ReturnType<typeof vi.fn<AdminApi['listGrantableUsers']>>;
  listCreatorGallery: ReturnType<typeof vi.fn<AdminApi['listCreatorGallery']>>;
  getCreatorMedia: ReturnType<typeof vi.fn<AdminApi['getCreatorMedia']>>;
  getUserDetail: ReturnType<typeof vi.fn<AdminApi['getUserDetail']>>;
  listUserRequests: ReturnType<typeof vi.fn<AdminApi['listUserRequests']>>;
  getUserRequest: ReturnType<typeof vi.fn<AdminApi['getUserRequest']>>;
  listUserHistory: ReturnType<typeof vi.fn<AdminApi['listUserHistory']>>;
  getBlockCheck: ReturnType<typeof vi.fn<AdminApi['getBlockCheck']>>;
  blockCreator: ReturnType<typeof vi.fn<AdminApi['blockCreator']>>;
  unblockCreator: ReturnType<typeof vi.fn<AdminApi['unblockCreator']>>;
  getUserBlockCheck: ReturnType<typeof vi.fn<AdminApi['getUserBlockCheck']>>;
  blockUser: ReturnType<typeof vi.fn<AdminApi['blockUser']>>;
  unblockUser: ReturnType<typeof vi.fn<AdminApi['unblockUser']>>;
  listUserSubscriptions: ReturnType<typeof vi.fn<AdminApi['listUserSubscriptions']>>;
  getGrantableCreators: ReturnType<typeof vi.fn<AdminApi['getGrantableCreators']>>;
  grantAccess: ReturnType<typeof vi.fn<AdminApi['grantAccess']>>;
  listAccessRequests: ReturnType<typeof vi.fn<AdminApi['listAccessRequests']>>;
  rejectAccessRequest: ReturnType<typeof vi.fn<AdminApi['rejectAccessRequest']>>;
  extendAccess: ReturnType<typeof vi.fn<AdminApi['extendAccess']>>;
  revokeAccess: ReturnType<typeof vi.fn<AdminApi['revokeAccess']>>;
  /** Simulates the client reporting that the session can no longer be renewed. */
  loseSession(): void;
}

/** An in-memory `AdminApi`. By default the admin is already signed in. */
export function createFakeAdminApi(
  overrides: Partial<
    Pick<
      AdminApi,
      | 'login'
      | 'me'
      | 'logout'
      | 'getCreatorRequest'
      | 'approveCreatorRequest'
      | 'rejectCreatorRequest'
      | 'listCreators'
      | 'listUsers'
      | 'getCreatorDetail'
      | 'listCreatorHistory'
      | 'getAuditLog'
      | 'getSubscription'
      | 'listSubscriptionEvents'
      | 'listCreatorSubscribers'
      | 'listCreatorGallery'
      | 'getCreatorMedia'
      | 'listGrantableUsers'
      | 'getUserDetail'
      | 'listUserRequests'
      | 'getUserRequest'
      | 'listUserHistory'
      | 'getBlockCheck'
      | 'blockCreator'
      | 'unblockCreator'
      | 'getUserBlockCheck'
      | 'blockUser'
      | 'unblockUser'
      | 'listUserSubscriptions'
      | 'getGrantableCreators'
      | 'grantAccess'
      | 'listAccessRequests'
      | 'rejectAccessRequest'
      | 'extendAccess'
      | 'revokeAccess'
    >
  > = {},
): FakeAdminApi {
  const listeners = new Set<() => void>();
  return {
    login: vi.fn(overrides.login ?? (async () => TEST_ADMIN)),
    me: vi.fn(overrides.me ?? (async () => TEST_ADMIN)),
    logout: vi.fn(overrides.logout ?? (async () => undefined)),
    // Not used by the auth specs: a call means a test forgot to provide an answer.
    getCreatorRequest: vi.fn(
      overrides.getCreatorRequest ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    approveCreatorRequest: vi.fn(
      overrides.approveCreatorRequest ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    rejectCreatorRequest: vi.fn(
      overrides.rejectCreatorRequest ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listCreators: vi.fn(
      overrides.listCreators ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listUsers: vi.fn(overrides.listUsers ?? (async () => Promise.reject(new Error('not stubbed')))),
    getCreatorDetail: vi.fn(
      overrides.getCreatorDetail ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listCreatorHistory: vi.fn(
      overrides.listCreatorHistory ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getUserDetail: vi.fn(
      overrides.getUserDetail ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listUserRequests: vi.fn(
      overrides.listUserRequests ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getUserRequest: vi.fn(
      overrides.getUserRequest ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listUserHistory: vi.fn(
      overrides.listUserHistory ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getSubscription: vi.fn(
      overrides.getSubscription ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listSubscriptionEvents: vi.fn(
      overrides.listSubscriptionEvents ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listCreatorSubscribers: vi.fn(
      overrides.listCreatorSubscribers ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listCreatorGallery: vi.fn(
      overrides.listCreatorGallery ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getCreatorMedia: vi.fn(
      overrides.getCreatorMedia ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listGrantableUsers: vi.fn(
      overrides.listGrantableUsers ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getAuditLog: vi.fn(
      overrides.getAuditLog ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getBlockCheck: vi.fn(
      overrides.getBlockCheck ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    blockCreator: vi.fn(
      overrides.blockCreator ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    unblockCreator: vi.fn(
      overrides.unblockCreator ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getUserBlockCheck: vi.fn(
      overrides.getUserBlockCheck ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    blockUser: vi.fn(overrides.blockUser ?? (async () => Promise.reject(new Error('not stubbed')))),
    unblockUser: vi.fn(
      overrides.unblockUser ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    listUserSubscriptions: vi.fn(
      overrides.listUserSubscriptions ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    getGrantableCreators: vi.fn(
      overrides.getGrantableCreators ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    grantAccess: vi.fn(
      overrides.grantAccess ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    // No pending requests unless a test says so, so the Langganan tab specs stay unchanged.
    listAccessRequests: vi.fn(overrides.listAccessRequests ?? (async () => ({ items: [] }))),
    rejectAccessRequest: vi.fn(
      overrides.rejectAccessRequest ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    extendAccess: vi.fn(
      overrides.extendAccess ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
    revokeAccess: vi.fn(
      overrides.revokeAccess ?? (async () => Promise.reject(new Error('not stubbed'))),
    ),
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
