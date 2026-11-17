import type { AuditLogDetail, CreatorDetail, HistoryRow } from '@creatorchat/contracts';

export const REQ_ID = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
export const CREATOR_ID = '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44';

export const REQUEST_DETAIL: CreatorDetail = {
  kind: 'request',
  id: REQ_ID,
  status: 'REQUEST',
  creator_name: 'Maya Lestari',
  avatar_url: null,
  telegram_username: 'mayalestari',
  telegram_id: '582917403',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  since: '2026-11-14T07:58:00.000Z',
  blocked_at: null,
  request: {
    id: REQ_ID,
    description:
      'Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.',
    user_role: 'USER',
    previous_rejections: 0,
    subscription_block: null,
  },
  creator: null,
};

export const ACTIVE_DETAIL: CreatorDetail = {
  kind: 'creator',
  id: CREATOR_ID,
  status: 'ACTIVE',
  creator_name: 'Salsa Maheswari',
  avatar_url: null,
  telegram_username: 'salsa.maheswari',
  telegram_id: '100200301',
  instagram_url: 'https://instagram.com/salsa.maheswari',
  creator_type: 'HUMAN',
  since: '2026-09-21T03:00:00.000Z',
  blocked_at: null,
  request: null,
  creator: {
    public_code: 'abcdefgh',
    subscriber_count: 58,
    bio: 'Suka masak sederhana, pasar pagi, dan cerita kecil di balik meja makan.',
    description: null,
  },
};

export const BLOCKED_DETAIL: CreatorDetail = {
  ...ACTIVE_DETAIL,
  status: 'BLOCKED',
  creator_name: 'Citra Anindya',
  telegram_username: 'citra.anindya',
  telegram_id: '455673201',
  blocked_at: '2026-11-13T04:20:00.000Z',
  creator: { ...ACTIVE_DETAIL.creator!, subscriber_count: 0 },
};

const hid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const HISTORY_ROWS: HistoryRow[] = [
  [
    '2026-11-09T03:12:00Z',
    'Salsa Maheswari',
    'Ajukan creator',
    'Permintaan dikirim',
    'application',
    'success',
  ],
  [
    '2026-09-21T07:05:00Z',
    'Admin Nadia',
    'Setujui creator',
    'Role USER → CREATOR',
    'application',
    'success',
  ],
  [
    '2026-09-12T02:30:00Z',
    'Sistem',
    'Login diblokir',
    'Login ditolak: akun diblokir',
    'account',
    'failed',
  ],
  [
    '2026-09-11T02:30:00Z',
    'Salsa Maheswari',
    'Bergabung',
    'Akun USER dibuat via Telegram',
    'account',
    'success',
  ],
].map(([at, actor, action, summary, kind, status], i) => ({
  id: hid(i + 1),
  at: at as string,
  actor: actor as string,
  action: action as string,
  summary: summary as string,
  kind: kind as HistoryRow['kind'],
  status: status as HistoryRow['status'],
}));

export const AUDIT_DETAIL: AuditLogDetail = {
  id: hid(1),
  at: '2026-11-13T04:20:18.000Z',
  actor: 'Admin Nadia',
  action: 'Block creator',
  kind: 'access',
  target: 'Citra Anindya (creator)',
  status: 'success',
  summary: 'Active → Blocked',
  reason: 'Pelanggaran ketentuan konten setelah laporan pengguna.',
  request_id: 'req_7c1f9a40e2',
  before: [
    { label: 'Status', value: 'Active' },
    { label: 'Subscriber aktif', value: '12' },
  ],
  after: [
    { label: 'Status', value: 'Blocked' },
    { label: 'Subscriber aktif', value: '12' },
  ],
};
