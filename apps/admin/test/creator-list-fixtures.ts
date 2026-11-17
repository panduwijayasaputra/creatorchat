import type { CreatorListQuery, CreatorListResponse, CreatorListRow } from '@creatorchat/contracts';

/**
 * Rows and a tiny in-memory "server" for component and visual tests. It mimics the API's filters,
 * sort and paging so the page can be exercised without a backend; the real behaviour is proved by
 * the service and API integration tests.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Seed = [
  name: string,
  kind: 'request' | 'creator',
  status: 'REQUEST' | 'ACTIVE' | 'BLOCKED',
  username: string,
  telegramId: string,
  instagram: string,
  type: 'HUMAN' | 'AI_CHARACTER',
  subscribers: number | null,
  date: string,
  activeSub?: boolean,
];

const SEEDS: Seed[] = [
  [
    'Maya Lestari',
    'request',
    'REQUEST',
    'mayalestari',
    '582917403',
    'maya.lestari',
    'HUMAN',
    null,
    '2026-11-14T05:00:00Z',
  ],
  [
    'Raka Putra',
    'request',
    'REQUEST',
    'rakaputra',
    '691042285',
    'raka.kitchen',
    'HUMAN',
    null,
    '2026-11-13T05:00:00Z',
    true,
  ],
  [
    'Luna Aurora',
    'request',
    'REQUEST',
    'lunaaurora',
    '774120936',
    'luna.aurora.ai',
    'AI_CHARACTER',
    null,
    '2026-11-12T05:00:00Z',
  ],
  [
    'Tika Wardani',
    'creator',
    'ACTIVE',
    'tikaw',
    '603318827',
    'tika.wardani',
    'HUMAN',
    37,
    '2026-11-11T05:00:00Z',
  ],
  [
    'Nayla Putri',
    'creator',
    'ACTIVE',
    'naylap',
    '512998340',
    'nayla.putri.ai',
    'AI_CHARACTER',
    35,
    '2026-11-06T05:00:00Z',
  ],
  [
    'Fajar Nugroho',
    'creator',
    'BLOCKED',
    'fajarn',
    '488120377',
    'fajar.nugroho',
    'HUMAN',
    0,
    '2026-10-28T05:00:00Z',
  ],
  [
    'Citra Anindya',
    'creator',
    'BLOCKED',
    'citra.anindya',
    '455673201',
    'citra.anindya',
    'HUMAN',
    0,
    '2026-10-20T05:00:00Z',
  ],
  [
    'Dinda Prameswari',
    'creator',
    'ACTIVE',
    'dinda.p',
    '390218845',
    'dinda.prameswari',
    'HUMAN',
    41,
    '2026-10-10T05:00:00Z',
  ],
  [
    'Kirana Larasati',
    'creator',
    'ACTIVE',
    'kirana.l',
    '361745092',
    'kirana.larasati',
    'HUMAN',
    46,
    '2026-10-04T05:00:00Z',
  ],
  [
    'Salsa Maheswari',
    'creator',
    'ACTIVE',
    'salsa.maheswari',
    '100200301',
    'salsa.maheswari',
    'HUMAN',
    58,
    '2026-09-21T05:00:00Z',
  ],
];

function extra(): Seed[] {
  const rows: Seed[] = [];
  for (let i = 0; i < 9; i += 1) {
    rows.push([
      `Creator ${String(i + 1).padStart(2, '0')}`,
      'creator',
      'ACTIVE',
      `creator${i + 1}`,
      String(200000000 + i),
      `creator.${i + 1}`,
      i % 2 ? 'AI_CHARACTER' : 'HUMAN',
      10 + i,
      `2026-09-${String(20 - i).padStart(2, '0')}T05:00:00Z`,
    ]);
  }
  return rows;
}

/** 19 rows, like the boards ("Menampilkan 1–10 dari 19 hasil"). */
export const LIST_ROWS: CreatorListRow[] = [...SEEDS, ...extra()].map((s, i) => ({
  kind: s[1],
  id: id(i + 1),
  status: s[2],
  creator_name: s[0],
  avatar_url: null,
  telegram_username: s[3],
  telegram_id: s[4],
  instagram_url: `https://instagram.com/${s[5]}`,
  creator_type: s[6],
  subscriber_count: s[7],
  has_active_subscription: s[9] ?? false,
  date: s[8],
}));

const NOW = new Date('2026-11-16T08:00:00Z').getTime();
const DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

export function listFrom(
  rows: readonly CreatorListRow[],
  query: CreatorListQuery,
): CreatorListResponse {
  const q = query.q?.toLowerCase();
  let items = rows.filter((row) => {
    if (!query.status.includes(row.status.toLowerCase() as 'request' | 'active' | 'blocked')) {
      return false;
    }
    if (query.type !== 'all' && row.creator_type !== query.type.toUpperCase()) return false;
    if (query.range !== 'all' && Date.parse(row.date) < NOW - DAYS[query.range] * 86_400_000) {
      return false;
    }
    return !q || row.creator_name.toLowerCase().includes(q) || row.telegram_id.startsWith(q);
  });
  const value = (row: CreatorListRow): string | number => {
    switch (query.sort) {
      case 'name':
        return row.creator_name.toLowerCase();
      case 'telegram':
        return (row.telegram_username ?? '').toLowerCase();
      case 'type':
        return row.creator_type;
      case 'status':
        return row.status;
      case 'subscribers':
        return row.subscriber_count ?? -1;
      default:
        return Date.parse(row.date);
    }
  };
  const sign = query.dir === 'asc' ? 1 : -1;
  items = [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || Date.parse(b.date) - Date.parse(a.date);
  });
  const start = (query.page - 1) * query.page_size;
  return {
    items: items.slice(start, start + query.page_size),
    total: items.length,
    page: query.page,
    page_size: query.page_size as 10 | 25 | 50,
  };
}

/** A query from URL parameters, for the visual harness' network stub (values are trusted fixtures). */
export function queryFromParams(params: URLSearchParams): CreatorListQuery {
  const get = (key: string) => params.get(key) ?? undefined;
  return {
    q: get('q') ?? null,
    status: (get('status')?.split(',') ?? [
      'request',
      'active',
      'blocked',
    ]) as CreatorListQuery['status'],
    type: (get('type') ?? 'all') as CreatorListQuery['type'],
    range: (get('range') ?? 'all') as CreatorListQuery['range'],
    sort: (get('sort') ?? 'date') as CreatorListQuery['sort'],
    dir: (get('dir') ?? 'desc') as CreatorListQuery['dir'],
    page: Number(get('page') ?? 1),
    page_size: Number(get('page_size') ?? 10) as CreatorListQuery['page_size'],
  };
}
