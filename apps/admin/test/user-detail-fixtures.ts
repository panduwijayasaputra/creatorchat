import type {
  UserDetailResponse,
  UserRequestDetail,
  UserRequestRow,
  UserRequestsResponse,
} from '@creatorchat/contracts';

export const USER_ID = '10000000-0000-4000-8000-000000000009';
export const PENDING_REQ = '30000000-0000-4000-8000-000000000002';
export const REJECTED_REQ = '30000000-0000-4000-8000-000000000001';
export const CREATOR_ID = '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44';

type UserDetail = Extract<UserDetailResponse, { role: 'USER' }>;

/** Raka Putra of `AdmUserSummary`. */
export const RAKA: UserDetail = {
  role: 'USER',
  user: {
    id: USER_ID,
    display_name: 'Raka Putra',
    avatar_url: null,
    telegram_username: 'rakaputra',
    telegram_id: '691042285',
    status: 'ACTIVE',
    bio: null,
    joined_at: '2026-10-20T05:00:00.000Z',
  },
  subscriptions: {
    active_count: 1,
    expired_count: 1,
    nearest_end: { creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T05:00:00.000Z' },
  },
  creator_request: {
    status: 'PENDING',
    submitted_at: '2026-11-13T07:20:00.000Z',
    rejection_count: 1,
    last_rejected_at: '2026-11-05T07:12:00.000Z',
    latest_request_id: PENDING_REQ,
  },
  block: null,
};

/** Dimas Aditya of `AdmUserBlocked`. */
export const DIMAS: UserDetail = {
  ...RAKA,
  user: {
    ...RAKA.user,
    id: '10000000-0000-4000-8000-000000000007',
    display_name: 'Dimas Aditya',
    telegram_username: 'dimasa',
    telegram_id: '520113948',
    status: 'BLOCKED',
    joined_at: '2026-10-28T05:00:00.000Z',
  },
  subscriptions: { active_count: 0, expired_count: 1, nearest_end: null },
  creator_request: {
    status: 'NONE',
    submitted_at: null,
    rejection_count: 0,
    last_rejected_at: null,
    latest_request_id: null,
  },
  block: {
    reason: 'penyalahgunaan layanan berulang',
    admin_label: 'Admin Nadia',
    at: '2026-11-10T03:05:00.000Z',
  },
};

export const REQUEST_ROWS: UserRequestRow[] = [
  {
    id: PENDING_REQ,
    created_at: '2026-11-13T07:20:00.000Z',
    ordinal: 2,
    status: 'PENDING',
    summary: 'Menunggu peninjauan',
  },
  {
    id: REJECTED_REQ,
    created_at: '2026-11-04T09:02:00.000Z',
    ordinal: 1,
    status: 'REJECTED',
    summary: 'Ditolak 5 Nov 2026: Link Instagram belum bisa kami verifikasi.',
  },
];

export const REQUESTS: UserRequestsResponse = {
  items: REQUEST_ROWS,
  total: 2,
  page: 1,
  page_size: 10,
  pending: {
    id: PENDING_REQ,
    subscription_block: {
      count: 1,
      creator_name: 'Salsa Maheswari',
      ends_at: '2026-11-27T05:00:00.000Z',
    },
  },
};

const base = {
  creator_name: 'Raka Putra',
  instagram_url: 'https://instagram.com/raka.kitchen',
  creator_type: 'HUMAN' as const,
  description: 'Resep masakan rumahan dan tips dapur untuk pemula.',
};
const applicant = {
  display_name: 'Raka Putra',
  telegram_username: 'rakaputra',
  telegram_id: '691042285',
};

export const PENDING_DETAIL: UserRequestDetail = {
  request: {
    ...base,
    id: PENDING_REQ,
    status: 'PENDING',
    created_at: '2026-11-13T07:20:00.000Z',
    ordinal: 2,
  },
  applicant,
  check: {
    block: { count: 1, creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T05:00:00.000Z' },
  },
  review: null,
};

export const REJECTED_DETAIL: UserRequestDetail = {
  request: {
    ...base,
    id: REJECTED_REQ,
    status: 'REJECTED',
    created_at: '2026-11-04T09:02:00.000Z',
    ordinal: 1,
  },
  applicant,
  check: null,
  review: {
    reason:
      'Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.',
    reviewed_at: '2026-11-05T07:12:00.000Z',
    reviewer_label: 'Admin Nadia',
    log_id: '20000000-0000-4000-8000-000000000001',
  },
};
