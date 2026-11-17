import type { UserListQuery, UserListResponse, UserListRow } from '@creatorchat/contracts';

/** The rows of `AdmUsers` (first page) plus filler, and a tiny in-memory "server" for component and visual tests. */
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Seed = [
  name: string,
  username: string | null,
  telegramId: string,
  status: 'ACTIVE' | 'BLOCKED',
  subs: number,
  request: 'NONE' | 'PENDING' | 'REJECTED',
  date: string,
];

const SEEDS: Seed[] = [
  ['Hendra Wijaya', 'hendraw', '299017733', 'ACTIVE', 1, 'NONE', '2026-11-13T05:00:00Z'],
  ['Putri Ayu', 'putriayu', '377120451', 'ACTIVE', 1, 'NONE', '2026-11-12T05:00:00Z'],
  ['Luna Aurora', 'lunaaurora', '774120936', 'ACTIVE', 0, 'PENDING', '2026-11-09T05:00:00Z'],
  ['Maya Lestari', 'mayalestari', '582917403', 'ACTIVE', 0, 'PENDING', '2026-11-08T05:00:00Z'],
  ['Bima Arya', 'bimaarya', '620194775', 'ACTIVE', 0, 'REJECTED', '2026-11-03T05:00:00Z'],
  ['Bayu Setiawan', 'bayus', '288104556', 'ACTIVE', 1, 'NONE', '2026-11-01T05:00:00Z'],
  ['Dimas Aditya', 'dimasa', '520113948', 'BLOCKED', 0, 'NONE', '2026-10-28T05:00:00Z'],
  ['Rani Anggraini', 'rani.a', '340981226', 'ACTIVE', 1, 'NONE', '2026-10-24T05:00:00Z'],
  ['Raka Putra', 'rakaputra', '691042285', 'ACTIVE', 1, 'PENDING', '2026-10-20T05:00:00Z'],
  ['Nadia Kusuma', 'nadiak', '410227839', 'ACTIVE', 0, 'NONE', '2026-10-02T05:00:00Z'],
];

/** 23 rows: enough for three pages. */
export const USER_ROWS: UserListRow[] = [
  ...SEEDS,
  ...Array.from({ length: 13 }, (_, i): Seed => [
    `Pengguna ${String(i + 1).padStart(2, '0')}`,
    null,
    String(800000000 + i),
    'ACTIVE',
    0,
    'NONE',
    `2026-09-${String(20 - i).padStart(2, '0')}T05:00:00Z`,
  ]),
].map((s, i) => ({
  id: id(i + 1),
  display_name: s[0],
  avatar_url: null,
  telegram_username: s[1],
  telegram_id: s[2],
  status: s[3],
  active_subscription_count: s[4],
  creator_request_status: s[5],
  pending_access_count: 0,
  joined_at: s[6],
}));

const NOW = new Date('2026-11-16T08:00:00Z').getTime();
const DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

export function userListFrom(rows: readonly UserListRow[], query: UserListQuery): UserListResponse {
  const q = query.q?.toLowerCase();
  const rank = { NONE: 0, PENDING: 1, REJECTED: 2 } as const;
  let items = rows.filter((row) => {
    if (!query.status.includes(row.status.toLowerCase() as 'active' | 'blocked')) return false;
    if (!query.request.includes(row.creator_request_status.toLowerCase() as 'none')) return false;
    if (query.access === 'pending' && row.pending_access_count === 0) return false;
    if (query.range !== 'all' && Date.parse(row.joined_at) < NOW - DAYS[query.range] * 86_400_000) {
      return false;
    }
    return !q || row.display_name.toLowerCase().includes(q) || row.telegram_id.startsWith(q);
  });
  const value = (row: UserListRow): string | number => {
    switch (query.sort) {
      case 'name':
        return row.display_name.toLowerCase();
      case 'telegram':
        return (row.telegram_username ?? '').toLowerCase();
      case 'status':
        return row.status;
      case 'subscriptions':
        return row.active_subscription_count;
      case 'request':
        return rank[row.creator_request_status];
      default:
        return Date.parse(row.joined_at);
    }
  };
  const sign = query.dir === 'asc' ? 1 : -1;
  items = [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || Date.parse(b.joined_at) - Date.parse(a.joined_at);
  });
  const start = (query.page - 1) * query.page_size;
  return {
    items: items.slice(start, start + query.page_size),
    total: items.length,
    page: query.page,
    page_size: query.page_size as 10 | 25 | 50,
  };
}
