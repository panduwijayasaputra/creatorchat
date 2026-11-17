import { Role, type CreatorApplicationStatus, type CreatorType } from '../src/index.js';

export interface UserFixture {
  telegramId: bigint;
  displayName: string;
  role: Role;
  telegramUsername: string;
  /** CREATOR fixtures only: the creator's public link code (8 chars of a-z2-7). */
  publicCode?: string;
  /** CREATOR fixtures only (US-012): copied onto the `creators` row when the seed creates it. */
  creatorType?: CreatorType;
  instagramUrl?: string;
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
    creatorType: 'HUMAN',
    instagramUrl: 'https://instagram.com/salsa.maheswari',
  },
  {
    telegramId: 9_000_000_002n,
    displayName: 'Kirana',
    role: Role.CREATOR,
    telegramUsername: 'kirana_sample',
    publicCode: 'kirana23',
    creatorType: 'HUMAN',
    instagramUrl: 'https://instagram.com/kirana.larasati',
  },
  {
    telegramId: 9_000_000_003n,
    displayName: 'Dinda',
    role: Role.CREATOR,
    telegramUsername: 'dinda_sample',
    publicCode: 'dinda234',
    creatorType: 'HUMAN',
    instagramUrl: 'https://instagram.com/dinda.prameswari',
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
  // Expired on 6 Nov 2026: the "Berakhir" card of the Explore board (US-022).
  {
    customerTelegramId: 9_000_000_012n,
    creatorPublicCode: 'kirana23',
    startsAt: new Date('2026-10-07T00:00:00.000Z'),
    endsAt: new Date('2026-11-06T00:00:00.000Z'),
  },
];

export interface ChatFixture {
  customerTelegramId: bigint;
  creatorPublicCode: string;
  messages: readonly { from: 'customer' | 'creator'; body: string; at: Date }[];
  /** The customer's read cursor (US-027): creator messages after this `seq` are unread. */
  customerLastReadSeq?: number;
}

/**
 * The text of the `Chat` (Salsa, access active) and `ChatExpired` (Kirana) boards for Raka Putra. The
 * media bubbles of the boards come with Phase D. The seed bypasses the grant service, so the
 * conversations are created here.
 */
export const CHAT_FIXTURES: readonly ChatFixture[] = [
  {
    customerTelegramId: 9_000_000_012n,
    creatorPublicCode: 'salsa234',
    // The two creator messages are unread: the `Chats` board's badge "2".
    customerLastReadSeq: 0,
    messages: [
      {
        from: 'creator',
        body: 'Versi pedas buat akhir pekan ini.',
        at: new Date('2026-11-16T11:02:00.000Z'),
      },
      {
        from: 'customer',
        body: 'Pengin coba bikin roti sobek.',
        at: new Date('2026-11-17T02:05:00.000Z'),
      },
      {
        from: 'creator',
        body: 'Gagal pertama itu wajar kok. Mulai dari adonan yang agak basah dulu.',
        at: new Date('2026-11-17T02:14:00.000Z'),
      },
    ],
  },
  {
    customerTelegramId: 9_000_000_012n,
    creatorPublicCode: 'kirana23',
    // Read up to her last message (seq 4): no unread.
    customerLastReadSeq: 4,
    messages: [
      {
        from: 'creator',
        body: 'Ini rangkuman latihan minggu ini. Jangan lupa istirahat cukup.',
        at: new Date('2026-11-06T09:20:00.000Z'),
      },
      {
        from: 'creator',
        body: 'Jadwal latihan minggu depan.',
        at: new Date('2026-11-06T09:21:00.000Z'),
      },
      {
        from: 'customer',
        body: 'Makasih kak, aku coba pelan-pelan dulu.',
        at: new Date('2026-11-06T09:30:00.000Z'),
      },
      {
        from: 'creator',
        body: 'Sampai ketemu di sesi berikutnya ya.',
        at: new Date('2026-11-06T09:32:00.000Z'),
      },
    ],
  },
];

export interface AccessRequestFixture {
  customerTelegramId: bigint;
  creatorPublicCode: string;
  type: 'TRIAL' | 'RENEWAL';
  createdAt: Date;
}

/**
 * Raka Putra has a pending trial request to Dinda (13 Nov 2026, 10.42 WIB): the "Menunggu" card of
 * the Explore board and `CreatorPending` (US-022). Salsa is active and Kirana expired for him.
 */
export const ACCESS_REQUEST_FIXTURES: readonly AccessRequestFixture[] = [
  {
    customerTelegramId: 9_000_000_012n,
    creatorPublicCode: 'dinda234',
    type: 'TRIAL',
    createdAt: new Date('2026-11-13T03:42:00.000Z'),
  },
];

export interface ApplicationFixture {
  userTelegramId: bigint;
  status: Extract<CreatorApplicationStatus, 'PENDING' | 'REJECTED'>;
  creatorName: string;
  instagramUrl: string;
  creatorType: CreatorType;
  description: string;
  reviewReason?: string;
  reviewedAt?: Date;
}

/**
 * Creator requests for the status screens (US-011) and the admin review (US-012): Maya Lestari and
 * Raka Putra are pending, Luna Aurora was rejected (the reason is the board's). Raka also has an
 * active subscription, so approving him fails (`AdmDlgApproveFail`). Because a pending request wins
 * on his Profile, his US-010 "blocked" screens are not reachable in the seed any more.
 */
export const APPLICATION_FIXTURES: readonly ApplicationFixture[] = [
  {
    userTelegramId: 9_000_000_011n,
    status: 'PENDING',
    creatorName: 'Maya Lestari',
    instagramUrl: 'https://instagram.com/maya.lestari',
    creatorType: 'HUMAN',
    description:
      'Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.',
  },
  {
    userTelegramId: 9_000_000_012n,
    status: 'PENDING',
    creatorName: 'Raka Putra',
    instagramUrl: 'https://instagram.com/raka.kitchen',
    creatorType: 'HUMAN',
    description: 'Masakan rumahan dan ulasan dapur, dibagikan lewat foto dan video pendek.',
  },
  {
    userTelegramId: 9_000_000_013n,
    status: 'REJECTED',
    creatorName: 'Luna Aurora',
    instagramUrl: 'https://instagram.com/luna.aurora',
    creatorType: 'AI_CHARACTER',
    description: 'Karakter AI penjelajah malam yang membagikan cerita dan foto kota.',
    reviewReason:
      'Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.',
    reviewedAt: new Date('2026-11-15T00:00:00.000Z'),
  },
];
