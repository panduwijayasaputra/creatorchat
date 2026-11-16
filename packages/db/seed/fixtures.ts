import { Role } from '../src/index.js';

export interface UserFixture {
  telegramId: bigint;
  displayName: string;
  role: Role;
  telegramUsername: string;
  /** CREATOR fixtures only: the creator's public link code (8 chars of a-z2-7). */
  publicCode?: string;
}

/**
 * Fictional accounts from the design's sample data (DESIGN.md → "Data sampel").
 * Telegram IDs sit in a reserved range (9_000_000_xxx) so they cannot collide with real accounts.
 * Only identity tables exist so far: creator profiles, subscriptions and conversations come with
 * their own phases' seeds.
 */
export const USER_FIXTURES: readonly UserFixture[] = [
  {
    telegramId: 9_000_000_001n,
    displayName: 'Salsa',
    role: Role.CREATOR,
    telegramUsername: 'salsa_sample',
    publicCode: 'salsa234',
  },
  {
    telegramId: 9_000_000_002n,
    displayName: 'Kirana',
    role: Role.CREATOR,
    telegramUsername: 'kirana_sample',
    publicCode: 'kirana23',
  },
  {
    telegramId: 9_000_000_003n,
    displayName: 'Dinda',
    role: Role.CREATOR,
    telegramUsername: 'dinda_sample',
    publicCode: 'dinda234',
  },
  {
    telegramId: 9_000_000_011n,
    displayName: 'Maya Lestari',
    role: Role.USER,
    telegramUsername: 'maya_sample',
  },
  {
    telegramId: 9_000_000_012n,
    displayName: 'Raka Putra',
    role: Role.USER,
    telegramUsername: 'raka_sample',
  },
  {
    telegramId: 9_000_000_013n,
    displayName: 'Luna Aurora',
    role: Role.USER,
    telegramUsername: 'luna_sample',
  },
];

export interface SubscriptionFixture {
  customerTelegramId: bigint;
  creatorPublicCode: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Raka Putra has an active subscription to Salsa until 27 Nov 2026, so the "cannot apply while a
 * customer subscription is active" paths (ProfileBlocked, CreatorRequestBlocked, a failing
 * approval) can be tried locally. The seed is local-only.
 */
export const SUBSCRIPTION_FIXTURES: readonly SubscriptionFixture[] = [
  {
    customerTelegramId: 9_000_000_012n,
    creatorPublicCode: 'salsa234',
    startsAt: new Date('2026-11-01T00:00:00.000Z'),
    endsAt: new Date('2026-11-27T00:00:00.000Z'),
  },
];
