import type {
  CreatorSubscribersResponse,
  SubscriptionActionResponse,
  SubscriptionRow,
  CreatorSubscriberRow,
  SubscriptionDetailResponse,
  SubscriptionEventsResponse,
} from '@creatorchat/contracts';

export const USER_ID = '10000000-0000-4000-8000-000000000009';
export const CREATOR_ID = '2c000000-0000-4000-8000-000000000001';
export const SUB_ID = '5b000000-0000-4000-8000-000000000001';
export const LOG_ID = '20000000-0000-4000-8000-000000000001';

/** Raka Putra → Salsa Maheswari of `AdmSubDetail`. */
export const ACTIVE_SUB: SubscriptionDetailResponse = {
  subscription: {
    id: SUB_ID,
    status: 'ACTIVE',
    starts_at: '2026-10-28T03:20:00.000Z',
    ends_at: '2026-11-27T16:59:59.000Z',
    revoked_at: null,
    source: 'ADMIN',
    created_by_label: 'Admin Nadia',
  },
  customer: {
    id: USER_ID,
    display_name: 'Raka Putra',
    telegram_username: 'rakaputra',
    telegram_id: '691042285',
  },
  creator: { id: CREATOR_ID, display_name: 'Salsa Maheswari' },
};

export const EXPIRED_SUB: SubscriptionDetailResponse = {
  ...ACTIVE_SUB,
  subscription: {
    ...ACTIVE_SUB.subscription,
    status: 'EXPIRED',
    ends_at: '2026-11-06T16:59:59.000Z',
  },
};
export const REVOKED_SUB: SubscriptionDetailResponse = {
  ...ACTIVE_SUB,
  subscription: {
    ...ACTIVE_SUB.subscription,
    status: 'REVOKED',
    revoked_at: '2026-11-10T03:00:00.000Z',
  },
};

export const EVENTS: SubscriptionEventsResponse = {
  items: [
    {
      id: '60000000-0000-4000-8000-000000000001',
      at: '2026-10-28T03:20:00.000Z',
      actor: 'Admin Nadia',
      action: 'Berikan akses',
      summary: '30 hari',
      status: 'success',
      log_id: LOG_ID,
    },
  ],
  total: 1,
  page: 1,
  page_size: 10,
};

const c = (n: number, name: string, username: string, tg: string) => ({
  id: `10000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  display_name: name,
  avatar_url: null,
  telegram_username: username,
  telegram_id: tg,
});

/** The first rows of `AdmCrSubs` (58 in total on the board). */
export const SUBSCRIBER_ROWS: CreatorSubscriberRow[] = [
  [1, 'Raka Putra', 'rakaputra', '691042285', 'ACTIVE', '2026-10-28', '2026-11-27'],
  [2, 'Rani Anggraini', 'rani.a', '340981226', 'ACTIVE', '2026-11-12', '2026-11-27'],
  [3, 'Bayu Setiawan', 'bayus', '288104556', 'ACTIVE', '2026-11-03', '2026-12-03'],
  [4, 'Nadia Kusuma', 'nadiak', '410227839', 'EXPIRED', '2026-10-01', '2026-10-31'],
  [5, 'Putri Ayu', 'putriayu', '377120451', 'ACTIVE', '2026-11-09', '2026-12-09'],
  [6, 'Hendra Wijaya', 'hendraw', '299017733', 'ACTIVE', '2026-10-30', '2026-11-29'],
  [7, 'Sari Wulandari', 'sariw', '318420915', 'EXPIRED', '2026-09-05', '2026-10-05'],
  [8, 'Galih Prakoso', 'galihp', '452198830', 'ACTIVE', '2026-11-01', '2026-12-01'],
].map(([n, name, username, tg, status, s, e]) => ({
  id: `5b000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  customer: c(n as number, name as string, username as string, tg as string),
  status: status as 'ACTIVE' | 'EXPIRED',
  starts_at: `${s}T03:00:00.000Z`,
  ends_at: `${e}T16:59:59.000Z`,
  revoked_at: null,
}));

export const SUBSCRIBERS: CreatorSubscribersResponse = {
  items: SUBSCRIBER_ROWS,
  total: 58,
  page: 1,
  page_size: 10,
};

/* ---------------- Langganan tab rows of `AdmUserSubs` (US-020) ---------------- */
/* Reconstructed in US-021: this file was rewritten by mistake and these exports are rebuilt from
   how `visual/specs/visual.spec.ts` and the Langganan tests use them (Salsa active, Kirana expired). */

export const SALSA_ACCESS: SubscriptionRow = {
  id: '5b000000-0000-4000-8000-000000000001',
  creator: {
    id: '2c000000-0000-4000-8000-000000000001',
    display_name: 'Salsa Maheswari',
    avatar_url: null,
  },
  status: 'ACTIVE',
  starts_at: '2026-10-28T03:20:00.000Z',
  ends_at: '2026-11-27T16:59:59.000Z',
  revoked_at: null,
};

export const KIRANA_ACCESS: SubscriptionRow = {
  id: '5b000000-0000-4000-8000-000000000002',
  creator: {
    id: '2c000000-0000-4000-8000-000000000002',
    display_name: 'Kirana Larasati',
    avatar_url: null,
  },
  status: 'EXPIRED',
  starts_at: '2026-10-07T03:20:00.000Z',
  ends_at: '2026-11-06T16:59:59.000Z',
  revoked_at: null,
};

export const ACCESS_ROWS: SubscriptionRow[] = [SALSA_ACCESS, KIRANA_ACCESS];

/** The answer of a grant / extend / revoke call for `row`. */
export function accessAction(
  row: SubscriptionRow,
  status: 'ACTIVE' | 'REVOKED',
  endsAt: string = row.ends_at,
): SubscriptionActionResponse {
  return {
    subscription: {
      id: row.id,
      creator_id: row.creator.id,
      status,
      starts_at: row.starts_at,
      ends_at: endsAt,
      revoked_at: status === 'REVOKED' ? '2026-11-14T05:00:00.000Z' : null,
    },
  };
}
