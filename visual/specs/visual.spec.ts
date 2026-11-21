import { readFileSync } from 'node:fs';
import { test, type Browser, type Locator, type Page, type Route } from '@playwright/test';
import { LIST_ROWS, listFrom, queryFromParams } from '../../apps/admin/test/creator-list-fixtures';
import {
  ACTIVE_DETAIL,
  AUDIT_DETAIL,
  BLOCKED_DETAIL,
  HISTORY_ROWS,
  REQUEST_DETAIL,
} from '../../apps/admin/test/creator-detail-fixtures';
import {
  DIMAS,
  PENDING_DETAIL,
  RAKA,
  REJECTED_DETAIL,
  REQUESTS,
} from '../../apps/admin/test/user-detail-fixtures';
import {
  GALLERY_ROWS,
  MEDIA_DETAIL,
  galleryPage as adminGalleryPage,
} from '../../apps/admin/test/gallery-fixtures';
import { USER_ROWS, userListFrom } from '../../apps/admin/test/user-list-fixtures';
import {
  ACCESS_ROWS,
  ACTIVE_SUB,
  EVENTS,
  KIRANA_ACCESS,
  SALSA_ACCESS,
  SUBSCRIBERS,
  SUB_ID,
  USER_ID as SUB_USER_ID,
  accessAction,
} from '../../apps/admin/test/subscription-fixtures';
import { ADMIN_URL, MINIAPP_URL, boardRect, compare, writeReport, type Comparison } from '../lib';

/**
 * Captures regions of the running apps and lays each next to the same region of the design
 * handoff PNG. Output goes to visual/output (git-ignored). The diff percentage is informational:
 * the sheets are what gets reviewed.
 */

const inboxRow = (
  n: number,
  name: string,
  preview: string,
  at: string,
  unread: number,
  active = true,
) => ({
  conversation_id: `33333333-0000-4000-8000-${String(n).padStart(12, '0')}`,
  customer: { display_name: name, avatar_url: null },
  preview,
  preview_media_kind: null,
  last_message_at: at,
  unread_count: unread,
  access_active: active,
});
const inboxBoardAnswer = {
  items: [
    inboxRow(
      1,
      'Rani Anggraini',
      'Oke, aku coba. Boleh minta rekomendasi tepungnya?',
      '2026-11-17T02:20:00.000Z',
      2,
    ),
    inboxRow(
      2,
      'Bayu Setiawan',
      'Kalau mau lebih pedas, tambahannya apa ya?',
      '2026-11-17T01:55:00.000Z',
      1,
    ),
    inboxRow(
      3,
      'Nadia Kusuma',
      'Terima kasih banyak ya kak, resepnya enak.',
      '2026-11-06T09:00:00.000Z',
      0,
      false,
    ),
  ],
  next_cursor: null,
  unread_conversations: 2,
};
const mockInbox = async (p: Page, json: unknown): Promise<void> => {
  await p.route('**/v1/creator/inbox**', (r) => r.fulfill({ status: 200, json }));
};

const mockChatRead = async (p: Page): Promise<void> => {
  await p.route('**/v1/chats/*/read', (r) =>
    r.fulfill({ status: 200, json: { last_read_seq: 3 } }),
  );
};

const CHAT_ID = '22222222-0000-4000-8000-000000000001';
const CR_CHAT_ID = '66666666-0000-4000-8000-000000000001';
const crChatMsg = (seq: number, sender: 'ME' | 'CUSTOMER', body: string, created_at: string) => ({
  id: `44444444-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  client_message_id: `55555555-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  sender,
  type: 'TEXT',
  body,
  attachments: [],
  origin: 'MANUAL',
  created_at,
});
const crChatPage = (
  state: 'ACTIVE' | 'EXPIRED',
  name: string,
  items: ReturnType<typeof crChatMsg>[],
) => ({
  conversation: {
    id: CR_CHAT_ID,
    customer: { display_name: name, avatar_url: null },
    access: {
      state,
      ends_at: state === 'ACTIVE' ? '2026-11-27T16:59:59.000Z' : null,
      ended_at: state === 'EXPIRED' ? '2026-11-06T16:59:59.000Z' : null,
    },
  },
  items,
  next_before: null,
});
const chatMsg = (seq: number, sender: 'ME' | 'CREATOR', body: string, created_at: string) => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  client_message_id: `11111111-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  seq,
  sender,
  type: 'TEXT',
  body,
  attachments: [],
  created_at,
});
/** A message of the creator with a photo or video (US-037). */
const chatMediaMsg = (
  seq: number,
  body: string | null,
  kind: 'PHOTO' | 'VIDEO',
  created_at: string,
) => ({
  ...chatMsg(seq, 'CREATOR', '', created_at),
  type: 'MEDIA',
  body,
  attachments: [
    {
      id: `77777777-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      kind,
      duration_seconds: kind === 'VIDEO' ? 42 : null,
      thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t${seq}`,
    },
  ],
});
/** One history page (newest first); the header differs per access state. */
const chatPage = (
  state: 'ACTIVE' | 'EXPIRED',
  items: (ReturnType<typeof chatMsg> | ReturnType<typeof chatMediaMsg>)[],
  name = 'Salsa Maheswari',
  peerReadSeq = 0,
) => ({
  conversation: {
    id: CHAT_ID,
    creator: { public_code: 'salsa234', display_name: name, avatar_url: null },
    access: {
      state,
      ends_at: state === 'ACTIVE' ? '2026-11-27T16:59:59.000Z' : null,
      ended_at: state === 'EXPIRED' ? '2026-11-06T16:59:59.000Z' : null,
    },
    peer_read_seq: peerReadSeq,
  },
  items,
  next_before: null,
});

// ---- Subscriber gallery fixture (US-034) ----
const customerGalleryAnswer = (count: number) => ({
  items: Array.from({ length: count }, (_, i) => {
    const a = galleryAsset(count - i, GALLERY_DURATIONS[i % GALLERY_DURATIONS.length] ?? null);
    return {
      id: a.id,
      kind: a.kind,
      duration_seconds: a.duration_seconds,
      thumbnail_url: a.thumbnail_url,
    };
  }),
  total: count,
  next_cursor: null,
});

// ---- Creator gallery fixtures (US-032) ----
const STAND_IN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F3DACB"/><circle cx="68" cy="34" r="14" fill="#E8B79F"/><path d="M0 70 C25 52 45 60 62 68 C78 76 90 64 100 58 V100 H0Z" fill="#C98F78"/><path d="M0 86 C30 74 60 82 100 76 V100 H0Z" fill="#8E5B48"/></svg>`;
const GALLERY_DURATIONS = [null, 48, null, null, 72, null, null, 36, null, null, 65, null];
const galleryAsset = (n: number, duration: number | null) => ({
  id: `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: duration === null ? 'PHOTO' : 'VIDEO',
  state: 'READY',
  failure: null,
  duration_seconds: duration,
  thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t${n}`,
  created_at: '2026-11-18T03:00:00.000Z',
});
const galleryAssets = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    galleryAsset(count - i, GALLERY_DURATIONS[i % GALLERY_DURATIONS.length] ?? null),
  );
async function mockGallery(p: Page, assets: ReturnType<typeof galleryAssets>, total: number) {
  await p.route('**/v1/dev-storage/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
  );
  await p.route('**/v1/creator/media/limits', (r) =>
    r.fulfill({
      status: 200,
      json: { photo_max_bytes: 10485760, video_max_bytes: 209715200, video_max_seconds: 300 },
    }),
  );
  await p.route('**/v1/creator/gallery**', (r) =>
    r.fulfill({
      status: 200,
      json: {
        items: assets.map((asset) => ({ asset, added_at: asset.created_at })),
        total,
        next_cursor: null,
      },
    }),
  );
}
/** One upload: init, a PUT that hangs at 64 % / succeeds / drops, complete, then READY. */
async function mockUploadFlow(p: Page, flow: 'uploading' | 'done' | 'failed') {
  const pending = { ...galleryAsset(900, null), state: 'PENDING', thumbnail_url: null };
  await p.route('**/v1/creator/media/uploads', (r) =>
    r.fulfill({
      status: 201,
      json: {
        asset: pending,
        upload: {
          url: 'http://localhost:3000/v1/dev-storage/m/up?s=1',
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          expires_at: '2026-11-18T03:15:00.000Z',
        },
      },
    }),
  );
  await p.route('**/v1/creator/media/uploads/*/complete', (r) =>
    r.fulfill({ status: 200, json: { asset: { ...pending, state: 'PROCESSING' } } }),
  );
  await p.route(/\/v1\/creator\/media\/4444[^/]*$/, (r) =>
    r.fulfill({ status: 200, json: { asset: galleryAsset(900, null) } }),
  );
  if (flow === 'uploading') {
    // A routed request cannot report upload progress, so the harness reports 64 % and never finishes.
    await p.addInitScript(() => {
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function patched(this: XMLHttpRequest, body) {
        if (this.upload) {
          setTimeout(() => {
            this.upload.dispatchEvent(
              new ProgressEvent('progress', { lengthComputable: true, loaded: 64, total: 100 }),
            );
          }, 50);
          return;
        }
        return send.call(this, body);
      };
    });
  }
  await p.route('**/v1/dev-storage/m/up**', (r) =>
    flow === 'failed' ? r.abort('connectionrefused') : r.fulfill({ status: 200, body: '' }),
  );
}

interface Item {
  name: string;
  app: 'admin' | 'miniapp';
  path: string;
  viewport: { width: number; height: number };
  /** PNG pixels per CSS pixel of the reference board (1 for admin, 2 for 390 px Mini App boards). */
  scale: number;
  /** Admin only: answer the session check as signed out (the login screen). Default is signed in. */
  signedOut?: boolean;
  /**
   * Mini App only: how the Telegram session behaves. Default `user` is a signed-in USER, so every
   * shell sheet passes the login gate without the API. `/__preview` pages are outside the gate.
   */
  session?: MiniappSession;
  /** Extra network stubs, installed before the page loads. */
  mock?: (page: Page) => Promise<void>;
  /** Runs before the capture (open a dialog, scroll…). */
  prepare?: (page: Page) => Promise<void>;
  actual: (page: Page) => Locator;
  reference: { board: string; png: string; locate: (page: Page) => Locator };
  /** Only the top `cap` CSS px of the element are compared (tall rails and sidebars). */
  cap?: number;
  /** CSS px to skip at the top of the reference board (a design-only strip such as the DEMO bar). */
  refTop?: number;
  /**
   * Height of the reference crop in CSS px, when measuring the board HTML is unreliable: the boards
   * ask Google Fonts for Inter, and with the network off the fallback font wraps text differently.
   */
  refHeight?: number;
}

const byText = (text: string) => (page: Page) => page.locator(`xpath=//div[text()='${text}']/..`);
const afterLabel = (text: string) => (page: Page) =>
  page.locator(`xpath=//div[text()='${text}']/following-sibling::div[1]`);

const BIOS: Record<string, string> = {
  dinda234:
    'Memotret kota dan cahaya pagi. Berbagi proses foto, cerita perjalanan, dan tips kamera untuk pemula.',
  salsa234:
    'Suka masak sederhana, pasar pagi, dan cerita kecil di balik meja makan. Menulis resep yang bisa dicoba di dapur kecil.',
  kirana23:
    'Pelatih kebugaran yang percaya pada kebiasaan kecil. Berbagi latihan singkat, catatan pemulihan, dan rutinitas pagi.',
};

const ADMIN_1440 = { width: 1440, height: 900 };

type MiniappSession =
  'user' | 'creator' | 'login' | 'outside' | 'connecting' | 'network' | 'expired' | 'blocked';

/** AuthStates board cards: a label div, then the 390 x 760 card as its next sibling. */
const authStateCard = (label: string) => (page: Page) =>
  page.locator(`xpath=//div[text()='${label}']/following-sibling::div[1]`);

const authBoard = (page: Page) => page.locator('body > div').first();

const authStates: Item[] = [
  { name: 'miniapp-auth-1-memuat', session: 'connecting', label: '1 · Memuat' },
  { name: 'miniapp-auth-2-gagal', session: 'network', label: '2 · Gagal, dengan retry' },
  {
    name: 'miniapp-auth-3-sesi-berakhir',
    session: 'expired',
    label: '3 · Sesi berakhir, dengan retry',
  },
].map(({ name, session, label }) => ({
  name,
  app: 'miniapp' as const,
  path: '/',
  viewport: { width: 390, height: 760 },
  scale: 1,
  session: session as MiniappSession,
  actual: (p: Page) => p.locator('main'),
  reference: { board: 'AuthStates', png: 'miniapp/AuthStates.png', locate: authStateCard(label) },
}));

/** Card of one numbered state on AdmLoginStates (label div, then a padded wrapper holding the card). */
type LoginState = Partial<Item> & { name: string; label: string };

const stateCard = (label: string) => (page: Page) =>
  page.locator(`xpath=//div[text()='${label}']/following-sibling::div[1]/div`);

const envelope = (code: string, details?: unknown) => ({
  code,
  message: 'visual',
  request_id: 'visual',
  ...(details ? { details } : {}),
});

async function fillLogin(page: Page, passwordText: string) {
  await page.getByLabel('Username', { exact: true }).fill('nadia.admin');
  await page.getByLabel('Password', { exact: true }).fill(passwordText);
}

const loginStates: Item[] = (
  [
    {
      name: 'admin-login-1-memeriksa',
      label: '1 · Memeriksa',
      mock: async (p) => {
        await p.route('**/v1/admin/auth/login', () => undefined); // never answers: stays busy
      },
      prepare: async (p) => {
        await fillLogin(p, 'abcdefghij');
        await p.getByRole('button', { name: 'Masuk' }).click();
      },
    },
    {
      name: 'admin-login-2-validasi',
      label: '2 · Validasi',
      prepare: async (p) => {
        await p.getByRole('button', { name: 'Masuk' }).click();
      },
    },
    {
      name: 'admin-login-3-kredensial-salah',
      label: '3 · Kredensial salah',
      mock: async (p) => {
        await p.route('**/v1/admin/auth/login', (r) =>
          r.fulfill({
            status: 401,
            json: envelope('INVALID_CREDENTIALS', { attempts: 2, max: 5 }),
          }),
        );
      },
      prepare: async (p) => {
        await fillLogin(p, '12345678');
        await p.getByRole('button', { name: 'Masuk' }).click();
        await p.getByRole('alert').waitFor();
      },
    },
    {
      name: 'admin-login-4-gagal-terhubung',
      label: '4 · Gagal terhubung, dengan retry',
      mock: async (p) => {
        await p.route('**/v1/admin/auth/login', (r) => r.abort('connectionrefused'));
      },
      prepare: async (p) => {
        await fillLogin(p, 'abcdefghij');
        await p.getByRole('button', { name: 'Masuk' }).click();
        await p.getByRole('alert').waitFor();
      },
    },
  ] satisfies LoginState[]
).map((state): Item => ({
  app: 'admin',
  path: '/login',
  viewport: { width: 1440, height: 860 },
  scale: 1,
  signedOut: true,
  actual: (p) => p.locator('main > div'),
  reference: {
    board: 'AdmLoginStates',
    png: 'admin/AdmLoginStates.png',
    locate: stateCard(state.label),
  },
  ...state,
}));

const MINIAPP_USER = {
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

/** The account the edit boards show (EditStates uses "Maya L" with a bio; EditProfile "Maya Lestari"). */
const mockCreatorList = async (p: Page) => {
  await p.route('**/v1/admin/creators**', (r) =>
    r.fulfill({
      status: 200,
      json: listFrom(LIST_ROWS, queryFromParams(new URL(r.request().url()).searchParams)),
    }),
  );
};

/** Creator detail, History and Detail Log (US-015): one detail answer for every id. */
const mockCreatorDetail = (detail: unknown) => async (p: Page) => {
  await p.route('**/v1/admin/creators/**', (r) => {
    const url = new URL(r.request().url());
    return r.fulfill({
      status: 200,
      json: url.pathname.endsWith('/history')
        ? { items: HISTORY_ROWS, total: HISTORY_ROWS.length, page: 1, page_size: 10 }
        : { detail, checked_at: '2026-11-16T08:00:00.000Z' },
    });
  });
  await p.route('**/v1/admin/audit-logs/**', (r) => r.fulfill({ status: 200, json: AUDIT_DETAIL }));
};

/** User detail (US-018): one answer per endpoint. */
const mockUserDetail = (detail: unknown, request: unknown) => async (p: Page) => {
  await p.route('**/v1/admin/users/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    const json = path.endsWith('/history')
      ? { items: HISTORY_ROWS, total: HISTORY_ROWS.length, page: 1, page_size: 10 }
      : path.includes('/requests/')
        ? request
        : path.endsWith('/requests')
          ? REQUESTS
          : detail;
    return r.fulfill({ status: 200, json });
  });
};

/** The user detail plus the Langganan calls (US-020). "Today" is fixed to 14 Nov 2026 as on the boards. */
const mockAccess = async (p: Page) => {
  await p.clock.setFixedTime(new Date('2026-11-14T05:00:00.000Z'));
  await mockUserDetail(RAKA, PENDING_DETAIL)(p);
  const url = (r: Route) => new URL(r.request().url()).pathname;
  await p.route('**/v1/admin/users/*/subscriptions**', (r) => {
    const path = url(r);
    if (path.endsWith('/extend'))
      return r.fulfill({
        status: 200,
        json: accessAction(SALSA_ACCESS, 'ACTIVE', '2026-12-27T16:59:59.000Z'),
      });
    if (path.endsWith('/revoke'))
      return r.fulfill({ status: 200, json: accessAction(SALSA_ACCESS, 'REVOKED') });
    if (r.request().method() === 'POST')
      return r.fulfill({
        status: 201,
        json: accessAction(KIRANA_ACCESS, 'ACTIVE', '2026-12-14T16:59:59.000Z'),
      });
    return r.fulfill({
      status: 200,
      json: { items: ACCESS_ROWS, total: ACCESS_ROWS.length, page: 1, page_size: 10 },
    });
  });
  await p.route('**/v1/admin/users/*/grantable-creators', (r) =>
    r.fulfill({
      status: 200,
      json: {
        items: [
          { id: KIRANA_ACCESS.creator.id, display_name: 'Kirana Larasati', avatar_url: null },
        ],
      },
    }),
  );
};

/** Subscription detail and the creator's subscribers (US-021). */
const mockSubscriptions = async (p: Page) => {
  await p.route('**/v1/admin/users/**', (r) =>
    r.fulfill({
      status: 200,
      json: new URL(r.request().url()).pathname.endsWith('/events') ? EVENTS : ACTIVE_SUB,
    }),
  );
};

/** The creator's Subscriber tab (US-021). */
const mockSubscribers = async (p: Page) => {
  await p.route('**/v1/admin/creators/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      status: 200,
      json: path.endsWith('/subscribers')
        ? SUBSCRIBERS
        : { detail: ACTIVE_DETAIL, checked_at: '2026-11-16T08:00:00.000Z' },
    });
  });
};

/** The creator's Galeri tab and a media detail (US-035). */
const mockAdminGallery = async (p: Page) => {
  await p.route('**/v1/dev-storage/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
  );
  await p.route('**/v1/dev-storage/m/o**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'video/webm',
      body: readFileSync(new URL('../fixtures/viewer-video.webm', import.meta.url)),
    }),
  );
  await p.route('**/v1/admin/creators/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/gallery'))
      return r.fulfill({ status: 200, json: adminGalleryPage(GALLERY_ROWS) });
    if (/\/gallery\/[^/]+$/.test(path)) return r.fulfill({ status: 200, json: MEDIA_DETAIL });
    return r.fulfill({
      status: 200,
      json: { detail: ACTIVE_DETAIL, checked_at: '2026-11-16T08:00:00.000Z' },
    });
  });
};

/** The User list (US-017): the page content area against `AdmUsers`' own `main`. */
/** The user list plus the calls behind its Block / Unblock buttons. */
const mockUserModeration = async (p: Page) => {
  await mockUserList(p);
  await p.route('**/v1/admin/users/*/block-check', (r) =>
    r.fulfill({
      status: 200,
      json: {
        user_status: 'ACTIVE',
        role: 'USER',
        active_subscriptions: 1,
        checked_at: '2026-11-16T08:00:00.000Z',
      },
    }),
  );
  await p.route('**/v1/admin/users/*/unblock', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').at(-2) ?? '';
    return r.fulfill({ status: 200, json: { user: { id, status: 'ACTIVE' } } });
  });
};

const mockUserList = async (p: Page) => {
  await p.route('**/v1/admin/users**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    const get = (k: string) => q.get(k) ?? undefined;
    return r.fulfill({
      status: 200,
      json: userListFrom(USER_ROWS, {
        q: get('q') ?? null,
        status: (get('status')?.split(',') ?? ['active', 'blocked']) as never,
        request: (get('request')?.split(',') ?? ['none', 'pending', 'rejected']) as never,
        access: (get('access') ?? 'any') as never,
        range: (get('range') ?? 'all') as never,
        sort: (get('sort') ?? 'date') as never,
        dir: (get('dir') ?? 'desc') as never,
        page: Number(get('page') ?? 1),
        page_size: Number(get('page_size') ?? 10) as never,
      }),
    });
  });
};

const LIST_REVIEW_REQUEST = (name: string, id: string, type: 'HUMAN' | 'AI_CHARACTER') => ({
  id,
  status: 'PENDING',
  creator_name: name,
  instagram_url: 'https://instagram.com/x',
  creator_type: type,
  description: 'Deskripsi',
  created_at: '2026-11-14T05:00:00.000Z',
  reviewed_at: null,
  review_reason: null,
  user: {
    id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
    display_name: name,
    telegram_username: 'x',
    telegram_id: '774120936',
    role: 'USER',
    status: 'ACTIVE',
  },
});

/** The list plus the review calls behind its Setujui / Tolak buttons. */
const mockCreatorListReview = async (p: Page) => {
  await mockCreatorList(p);
  await p.route('**/v1/admin/creator-requests/*', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop() ?? '';
    const luna = id === LIST_ROWS[2]?.id;
    const request = LIST_REVIEW_REQUEST(
      luna ? 'Luna Aurora' : 'Maya Lestari',
      id,
      luna ? 'AI_CHARACTER' : 'HUMAN',
    );
    return r.fulfill({
      status: 200,
      json: { request, check: { block: null, checked_at: '2026-11-16T08:02:00.000Z' } },
    });
  });
  await p.route('**/v1/admin/creator-requests/*/reject', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').at(-2) ?? '';
    return r.fulfill({
      status: 200,
      json: {
        request: {
          ...LIST_REVIEW_REQUEST('Luna Aurora', id, 'AI_CHARACTER'),
          status: 'REJECTED',
          reviewed_at: '2026-11-16T08:03:00.000Z',
          review_reason: 'x',
        },
      },
    });
  });
};

/** The list plus the block / unblock calls behind its Block / Unblock buttons. */
const mockCreatorListModeration = async (p: Page) => {
  await mockCreatorList(p);
  await p.route('**/v1/admin/creators/*/block-check', (r) =>
    r.fulfill({
      status: 200,
      json: {
        creator_status: 'ACTIVE',
        active_subscribers: 58,
        checked_at: '2026-11-16T08:02:00.000Z',
      },
    }),
  );
  await p.route('**/v1/admin/creators/*/unblock', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').at(-2) ?? '';
    return r.fulfill({ status: 200, json: { creator: { id, status: 'ACTIVE' } } });
  });
};

const mockEditProfileUser = async (p: Page, displayName = 'Maya Lestari') => {
  await p.route('**/v1/me', (r) =>
    r.fulfill({
      status: 200,
      json: {
        ...MINIAPP_USER,
        display_name: displayName,
        telegram_username: 'mayalestari',
        bio: 'Pecinta masak dan buku resep.',
      },
    }),
  );
};

const editStateCard = (label: string) => (page: Page) =>
  page.locator(`xpath=//div[text()='${label}']/following-sibling::div[1]`);

type EditState = {
  name: string;
  label: string;
  /** Answers the save request; leaving it out means the request never completes ("Menyimpan"). */
  patch?: (route: Route) => void | Promise<void>;
  /** Empty both fields before saving (the validation card). */
  clear?: boolean;
};

const savedMaya = {
  ...MINIAPP_USER,
  display_name: 'Maya L',
  telegram_username: 'mayalestari',
  bio: 'Pecinta masak dan buku resep.',
};

const editStateSpecs: EditState[] = [
  { name: 'miniapp-edit-1-menyimpan', label: '1 · Menyimpan', patch: () => undefined },
  { name: 'miniapp-edit-2-validasi', label: '2 · Validasi', clear: true },
  {
    name: 'miniapp-edit-3-berhasil',
    label: '3 · Berhasil',
    patch: (r) => r.fulfill({ status: 200, json: savedMaya }),
  },
  {
    name: 'miniapp-edit-4-gagal',
    label: '4 · Gagal, isian dipertahankan',
    patch: (r) => r.abort('connectionrefused'),
  },
];

const editStates: Item[] = editStateSpecs.map(({ name, label, patch, clear }) => ({
  name,
  app: 'miniapp',
  path: '/profile/edit',
  viewport: { width: 390, height: 960 },
  scale: 1,
  session: 'user',
  mock: async (p) => {
    await mockEditProfileUser(p, 'Maya L');
    if (patch) await p.route('**/v1/me/profile', patch);
  },
  prepare: async (p) => {
    if (clear) {
      await p.getByLabel('Nama tampil').fill('');
      await p.getByLabel('Bio singkat (opsional)').fill('');
    }
    await p.getByRole('button', { name: 'Simpan Perubahan' }).click();
    if (name.endsWith('menyimpan')) await p.getByRole('button', { name: /Menyimpan/ }).waitFor();
    if (name.endsWith('validasi')) await p.getByText('Nama tampil wajib diisi.').waitFor();
    if (name.endsWith('berhasil')) await p.getByRole('status').waitFor();
    if (name.endsWith('gagal')) await p.getByRole('alert').waitFor();
  },
  actual: (p) => p.locator('#root > form'),
  reference: { board: 'EditStates', png: 'miniapp/EditStates.png', locate: editStateCard(label) },
}));

/** The creator request boards (US-010): GET answers the state, POST (the submit) is per card. */
const mockCreatorRequest = async (
  p: Page,
  options: {
    blocked?: { creator_name: string; ends_at: string } | null;
    /** The latest request the GET returns (US-011 boards); default none. */
    request?: Record<string, unknown> | null;
    post?: (route: Route) => void | Promise<void>;
  } = {},
) => {
  await p.route('**/v1/me', (r) =>
    r.fulfill({
      status: 200,
      json: { ...MINIAPP_USER, display_name: 'Maya Lestari', telegram_username: 'mayalestari' },
    }),
  );
  await p.route('**/v1/me/creator-request', (r) => {
    if (r.request().method() === 'POST' && options.post) return options.post(r);
    return r.fulfill({
      status: 200,
      json: { request: options.request ?? null, blocked: options.blocked ?? null },
    });
  });
};

/** The board's sample request (US-011): Maya Lestari, pending, or rejected with the board's reason. */
const SAMPLE_REQUEST = {
  id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.',
  created_at: '2026-11-16T05:00:00.000Z',
};
const PENDING_REQUEST = {
  ...SAMPLE_REQUEST,
  status: 'PENDING',
  reviewed_at: null,
  review_reason: null,
};
const REJECTED_REQUEST = {
  ...SAMPLE_REQUEST,
  status: 'REJECTED',
  reviewed_at: '2026-11-15T00:00:00.000Z',
  review_reason:
    'Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.',
};

const requestStateSpecs: {
  name: string;
  label: string;
  post?: (route: Route) => void | Promise<void>;
}[] = [
  { name: 'miniapp-request-1-validasi', label: '1 · Validasi' },
  { name: 'miniapp-request-2-mengirim', label: '2 · Mengirim', post: () => undefined },
  {
    name: 'miniapp-request-3-gagal',
    label: '3 · Gagal, isian dipertahankan',
    post: (r) => r.abort('connectionrefused'),
  },
];

const requestStates: Item[] = requestStateSpecs.map(({ name, label, post }) => ({
  name,
  app: 'miniapp',
  path: '/profile/creator-request',
  viewport: { width: 390, height: 1180 },
  scale: 1,
  session: 'user',
  mock: (p) => mockCreatorRequest(p, post ? { post } : {}),
  prepare: async (p) => {
    const link = p.getByLabel('Link profil Instagram');
    await link.waitFor();
    if (name.endsWith('validasi')) {
      await link.fill('instagram maya');
    } else {
      await link.fill('https://instagram.com/mayalestari');
      await p
        .getByLabel('Deskripsi singkat konten')
        .fill('Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.');
      await p.getByRole('checkbox').check();
    }
    await p.getByRole('button', { name: 'Kirim Permintaan' }).click();
    if (name.endsWith('validasi')) await p.getByText('Deskripsi wajib diisi.').waitFor();
    if (name.endsWith('mengirim')) await p.getByRole('button', { name: /Mengirim/ }).waitFor();
    if (name.endsWith('gagal')) await p.getByRole('alert').waitFor();
  },
  actual: (p) => p.locator('#root > form'),
  reference: {
    board: 'RequestStates',
    png: 'miniapp/RequestStates.png',
    locate: editStateCard(label),
  },
}));

const items: Item[] = [
  // ---- admin foundation (AdmMain) ----
  {
    name: 'admin-palette',
    app: 'admin',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 1,
    actual: (p) => p.locator('[data-preview-section="palette"]'),
    reference: {
      board: 'AdmMain',
      png: 'admin/AdmMain.png',
      locate: byText('Palet dan tipografi'),
    },
  },
  {
    name: 'admin-status-buttons',
    app: 'admin',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 1,
    actual: (p) => p.locator('[data-preview-section="status-buttons"]'),
    reference: { board: 'AdmMain', png: 'admin/AdmMain.png', locate: byText('Status dan tombol') },
  },
  // ---- table states (AdmTableStates) ----
  ...(
    [
      ['table-loading', 'Loading'],
      ['table-empty', 'Kosong'],
      ['table-no-results', 'Tidak ada hasil pencarian atau filter'],
      ['table-error', 'Error, dengan retry'],
    ] as const
  ).map(([id, label]): Item => ({
    name: `admin-${id}`,
    app: 'admin',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 1,
    actual: (p) => p.locator(`[data-preview-section="${id}"] > section`),
    reference: {
      board: 'AdmTableStates',
      png: 'admin/AdmTableStates.png',
      locate: afterLabel(label),
    },
  })),
  // ---- admin shell ----
  {
    name: 'admin-sidebar-1440',
    app: 'admin',
    path: '/',
    viewport: ADMIN_1440,
    scale: 1,
    cap: 420,
    actual: (p) => p.locator('aside'),
    reference: {
      board: 'AdmDashboard',
      png: 'admin/AdmDashboard.png',
      locate: (p) => p.locator('aside'),
    },
  },
  {
    name: 'admin-topbar-1440',
    app: 'admin',
    path: '/',
    viewport: ADMIN_1440,
    scale: 1,
    actual: (p) => p.locator('header'),
    reference: {
      board: 'AdmDashboard',
      png: 'admin/AdmDashboard.png',
      locate: (p) => p.locator('header'),
    },
  },
  {
    name: 'admin-rail-1024',
    app: 'admin',
    path: '/',
    viewport: { width: 1024, height: 900 },
    scale: 1,
    cap: 420,
    actual: (p) => p.locator('aside'),
    reference: {
      board: 'AdmDashTablet',
      png: 'admin/AdmDashTablet.png',
      locate: (p) => p.locator('aside'),
    },
  },
  {
    name: 'admin-topbar-1024',
    app: 'admin',
    path: '/',
    viewport: { width: 1024, height: 900 },
    scale: 1,
    actual: (p) => p.locator('header'),
    reference: {
      board: 'AdmDashTablet',
      png: 'admin/AdmDashTablet.png',
      locate: (p) => p.locator('header'),
    },
  },
  {
    name: 'admin-topbar-390',
    app: 'admin',
    path: '/',
    viewport: { width: 390, height: 844 },
    scale: 2,
    actual: (p) => p.locator('header'),
    reference: {
      board: 'AdmDashMobile',
      png: 'admin/AdmDashMobile.png',
      locate: (p) => p.locator('header'),
    },
  },
  {
    name: 'admin-logout-dialog',
    app: 'admin',
    path: '/',
    viewport: ADMIN_1440,
    scale: 1,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Logout' }).first().click();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmLogoutDlg',
      png: 'admin/AdmLogoutDlg.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  // ---- creator review dialogs (US-012): only the dialog card is compared; the list behind the
  // backdrop on the boards is US-014. The dialogs open from the /__preview section. ----
  ...(
    [
      {
        name: 'admin-dlg-approve',
        board: 'AdmDlgApprove',
        refHeight: 428,
        open: 'Setujui (Maya)',
        prepare: async (p: Page) => {
          await p.getByText(/Diperiksa ulang/).waitFor();
        },
      },
      {
        name: 'admin-dlg-approve-loading',
        board: 'AdmDlgApproveLoading',
        refHeight: 428,
        open: 'Setujui (memproses)',
        prepare: async (p: Page) => {
          await p.getByText(/Diperiksa ulang/).waitFor();
          await p.getByRole('button', { name: 'Setujui Creator' }).click();
          await p.getByRole('button', { name: 'Memproses…' }).waitFor();
        },
      },
      {
        name: 'admin-dlg-approve-fail',
        board: 'AdmDlgApproveFail',
        open: 'Setujui (langganan aktif)',
        prepare: async (p: Page) => {
          await p.getByText('Tidak bisa disetujui').waitFor();
        },
      },
      {
        name: 'admin-dlg-reject',
        board: 'AdmDlgReject',
        open: 'Tolak (Luna)',
        prepare: async (p: Page) => {
          await p.getByText('Luna Aurora').waitFor();
          await p
            .getByLabel('Alasan penolakan (wajib)')
            .fill(
              'Deskripsi konten belum cukup jelas. Mohon jelaskan jenis karakter dan siapa yang mengelolanya.',
            );
          // The board shows the field unfocused.
          await p.getByLabel('Alasan penolakan (wajib)').blur();
        },
      },
      {
        name: 'admin-dlg-reject-empty',
        board: 'AdmDlgRejectEmpty',
        open: 'Tolak (Luna)',
        prepare: async (p: Page) => {
          await p.getByText('Luna Aurora').waitFor();
          const field = p.getByLabel('Alasan penolakan (wajib)');
          await field.fill('x');
          await field.fill('');
          await p.getByText('Alasan wajib diisi.').waitFor();
          // The board shows the field unfocused.
          await field.blur();
        },
      },
    ] as const
  ).map((card): Item => ({
    name: card.name,
    ...('refHeight' in card ? { refHeight: card.refHeight } : {}),
    app: 'admin',
    path: '/__preview',
    viewport: ADMIN_1440,
    scale: 1,
    prepare: async (p) => {
      await p
        .locator('[data-preview-section="creator-review"]')
        .getByRole('button', { name: card.open })
        .click();
      await p.getByRole('dialog').waitFor();
      await card.prepare(p);
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: card.board,
      png: `admin/${card.board}.png`,
      locate: (p) => p.locator('[role=dialog]'),
    },
  })),
  // ---- Creator list (US-014): the page content area, next to each board's own `main` ----
  ...(
    [
      ['admin-creators-1440', 'AdmCreators', { width: 1440, height: 1040 }, 1],
      ['admin-creators-1024', 'AdmCreatorsTablet', { width: 1024, height: 900 }, 1],
      ['admin-creators-390', 'AdmCreatorsMobile', { width: 390, height: 1000 }, 2],
    ] as const
  ).map(([name, board, viewport, scale]): Item => ({
    name,
    app: 'admin',
    path: '/creators',
    viewport,
    scale,
    mock: mockCreatorList,
    prepare: async (p) => {
      await p.getByText('Maya Lestari').waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: { board, png: `admin/${board}.png`, locate: (p) => p.locator('main') },
  })),
  ...(
    [
      [
        'admin-cr-req',
        'AdmCrReq',
        REQUEST_DETAIL,
        `/creators/${REQUEST_DETAIL.id}`,
        'Maya Lestari',
      ],
      [
        'admin-cr-active',
        'AdmCrActive',
        ACTIVE_DETAIL,
        `/creators/${ACTIVE_DETAIL.id}`,
        'Salsa Maheswari',
      ],
      [
        'admin-cr-blocked',
        'AdmCrBlocked',
        BLOCKED_DETAIL,
        `/creators/${BLOCKED_DETAIL.id}`,
        'Citra Anindya',
      ],
      [
        'admin-cr-history',
        'AdmCrHistory',
        ACTIVE_DETAIL,
        `/creators/${ACTIVE_DETAIL.id}/history`,
        'Setujui creator',
        1000,
      ],
      [
        'admin-log-detail',
        'AdmLogDetail',
        ACTIVE_DETAIL,
        `/logs/${AUDIT_DETAIL.id}`,
        'Ringkasan kejadian',
        860,
      ],
    ] as const
  ).map(([name, board, detail, path, ready, height = 1180]): Item => ({
    name,
    app: 'admin',
    path,
    viewport: { width: 1440, height },
    scale: 1,
    mock: mockCreatorDetail(detail),
    prepare: async (p) => {
      await p.getByText(ready).first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: { board, png: `admin/${board}.png`, locate: (p) => p.locator('main') },
  })),
  ...(
    [
      ['admin-user-summary', 'AdmUserSummary', RAKA, '', 'Profil aplikasi', 900],
      ['admin-user-blocked', 'AdmUserBlocked', DIMAS, '', 'Akun diblokir', 900],
      ['admin-user-request', 'AdmUserRequest', RAKA, '/requests', 'Pengajuan ke-2', 900],
      ['admin-user-history', 'AdmUserHistory', RAKA, '/history', 'Setujui creator', 900],
      [
        'admin-req-detail',
        'AdmReqDetail',
        RAKA,
        `/requests/${PENDING_DETAIL.request.id}`,
        'Status peninjauan',
        760,
      ],
      [
        'admin-req-detail-rej',
        'AdmReqDetailRej',
        RAKA,
        `/requests/${REJECTED_DETAIL.request.id}`,
        'Hasil peninjauan',
        760,
      ],
    ] as const
  ).map(([name, board, detail, suffix, ready, height]): Item => ({
    name,
    app: 'admin',
    path: `/users/${RAKA.user.id}${suffix}`,
    viewport: { width: 1440, height },
    scale: 1,
    mock: mockUserDetail(
      detail,
      suffix.includes(REJECTED_DETAIL.request.id) ? REJECTED_DETAIL : PENDING_DETAIL,
    ),
    prepare: async (p) => {
      await p.getByText(ready).first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: { board, png: `admin/${board}.png`, locate: (p) => p.locator('main') },
  })),
  {
    name: 'admin-cr-subs',
    app: 'admin',
    path: `/creators/${ACTIVE_DETAIL.id}/subscribers`,
    viewport: { width: 1440, height: 1300 },
    scale: 1,
    mock: mockSubscribers,
    prepare: async (p) => {
      await p.getByText('Raka Putra').first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: { board: 'AdmCrSubs', png: 'admin/AdmCrSubs.png', locate: (p) => p.locator('main') },
  },
  // ---- Creator gallery (US-035): the boards' illustrations are a flat stand-in; the list shows 8 of 12 on the board only ----
  {
    name: 'admin-cr-gallery',
    app: 'admin',
    path: `/creators/${ACTIVE_DETAIL.id}/gallery`,
    viewport: { width: 1440, height: 1360 },
    scale: 1,
    mock: mockAdminGallery,
    prepare: async (p) => {
      await p.getByText('Media #12').first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: {
      board: 'AdmCrGallery',
      png: 'admin/AdmCrGallery.png',
      locate: (p) => p.locator('main'),
    },
  },
  {
    name: 'admin-media-detail',
    app: 'admin',
    path: `/creators/${ACTIVE_DETAIL.id}/gallery/${MEDIA_DETAIL.asset_id}`,
    viewport: { width: 1440, height: 800 },
    scale: 1,
    mock: mockAdminGallery,
    prepare: async (p) => {
      await p.getByText('Informasi media').waitFor();
      await p.waitForTimeout(400);
    },
    actual: (p) => p.locator('main'),
    reference: {
      board: 'AdmMediaDetail',
      png: 'admin/AdmMediaDetail.png',
      locate: (p) => p.locator('main'),
    },
  },
  {
    name: 'admin-sub-detail',
    app: 'admin',
    path: `/users/${SUB_USER_ID}/subscriptions/${SUB_ID}`,
    viewport: { width: 1440, height: 760 },
    scale: 1,
    mock: mockSubscriptions,
    prepare: async (p) => {
      await p.getByText('Berikan akses').first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: {
      board: 'AdmSubDetail',
      png: 'admin/AdmSubDetail.png',
      locate: (p) => p.locator('main'),
    },
  },
  {
    name: 'admin-users-1440',
    app: 'admin',
    path: '/users',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockUserList,
    prepare: async (p) => {
      await p.getByText('Hendra Wijaya').waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: { board: 'AdmUsers', png: 'admin/AdmUsers.png', locate: (p) => p.locator('main') },
  },
  // ---- decisions from the list (US-014): the dialog and the toast opened from the real page ----
  {
    name: 'admin-list-dlg-approve',
    app: 'admin',
    path: '/creators',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockCreatorListReview,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Setujui Maya Lestari' }).click();
      await p.getByText(/Diperiksa ulang/).waitFor();
    },
    actual: (p) => p.getByRole('dialog'),
    refHeight: 428,
    reference: {
      board: 'AdmDlgApprove',
      png: 'admin/AdmDlgApprove.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-list-toast-rejected',
    app: 'admin',
    path: '/creators',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockCreatorListReview,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Tolak Luna Aurora' }).click();
      await p.getByText('Luna Aurora').nth(1).waitFor();
      await p.getByLabel('Alasan penolakan (wajib)').fill('x');
      await p.getByRole('button', { name: 'Tolak Permintaan' }).click();
      await p.getByText('Permintaan Luna Aurora ditolak dan dicatat').waitFor();
    },
    actual: (p) => p.getByRole('status').filter({ hasText: 'ditolak dan dicatat' }),
    reference: {
      board: 'AdmCreatorsToastRej',
      png: 'admin/AdmCreatorsToastRej.png',
      locate: (p) => p.locator('[role=status]'),
    },
  },
  // ---- creator block / unblock (US-016): the dialog card and the list toast ----
  {
    name: 'admin-dlg-block',
    app: 'admin',
    path: '/creators',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockCreatorListModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Block Salsa Maheswari' }).click();
      await p.getByText('58 subscriber aktif').waitFor();
      const field = p.getByLabel('Alasan block (wajib)');
      await field.fill('Pelanggaran ketentuan konten setelah laporan pengguna.');
      await field.blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgBlock',
      png: 'admin/AdmDlgBlock.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-dlg-unblock',
    app: 'admin',
    path: '/creators',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockCreatorListModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Unblock Citra Anindya' }).click();
      const field = p.getByLabel('Alasan unblock (wajib)');
      await field.fill('Banding diterima, konten sudah disesuaikan.');
      await field.blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgUnblock',
      png: 'admin/AdmDlgUnblock.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-list-toast-unblocked',
    app: 'admin',
    path: '/creators',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockCreatorListModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Unblock Citra Anindya' }).click();
      await p.getByLabel('Alasan unblock (wajib)').fill('x');
      await p.getByRole('button', { name: 'Unblock Creator' }).click();
      await p.getByText('Citra Anindya kembali Active').waitFor();
    },
    actual: (p) => p.getByRole('status').filter({ hasText: 'kembali Active' }),
    reference: {
      board: 'AdmCreatorsToastUnblock',
      png: 'admin/AdmCreatorsToastUnblock.png',
      locate: (p) => p.locator('[role=status]'),
    },
  },
  // ---- user block / unblock from the /users list (US-019): dialog cards and the toast ----
  {
    name: 'admin-users-dlg-block',
    app: 'admin',
    path: '/users',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockUserModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Block Raka Putra' }).click();
      await p.getByText('(1)').waitFor();
      await p
        .getByLabel('Alasan block (wajib)')
        .fill('Penyalahgunaan layanan berulang setelah peringatan.');
      await p.getByLabel('Alasan block (wajib)').blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgUserBlock',
      png: 'admin/AdmDlgUserBlock.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-users-dlg-unblock',
    app: 'admin',
    path: '/users',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockUserModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Unblock Dimas Aditya' }).click();
      await p.getByLabel('Alasan unblock (wajib)').fill('Banding diterima setelah peninjauan.');
      await p.getByLabel('Alasan unblock (wajib)').blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgUserUnblock',
      png: 'admin/AdmDlgUserUnblock.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-users-toast-unblock',
    app: 'admin',
    path: '/users',
    viewport: { width: 1440, height: 1040 },
    scale: 1,
    mock: mockUserModeration,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Unblock Dimas Aditya' }).click();
      await p.getByLabel('Alasan unblock (wajib)').fill('x');
      await p.getByRole('button', { name: 'Unblock User' }).click();
      await p.getByText('Dimas Aditya kembali Active').waitFor();
    },
    actual: (p) => p.getByRole('status').filter({ hasText: 'kembali Active' }),
    reference: {
      board: 'AdmUsersToastUnblock',
      png: 'admin/AdmUsersToastUnblock.png',
      locate: (p) => p.locator('[role=status]'),
    },
  },
  // ---- user access: the Langganan tab, its three dialogs and toasts (US-020) ----
  {
    name: 'admin-user-subs',
    app: 'admin',
    path: `/users/${RAKA.user.id}/subscriptions`,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    mock: mockAccess,
    prepare: async (p) => {
      await p.getByText('Kirana Larasati').first().waitFor();
    },
    actual: (p) => p.locator('main'),
    reference: {
      board: 'AdmUserSubs',
      png: 'admin/AdmUserSubs.png',
      locate: (p) => p.locator('main'),
    },
  },
  {
    name: 'admin-dlg-grant',
    app: 'admin',
    path: `/users/${RAKA.user.id}/subscriptions`,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    mock: mockAccess,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Berikan Akses' }).click();
      await p.getByRole('dialog').getByLabel('Creator', { exact: true }).waitFor();
      await p.getByLabel('Alasan (wajib)').fill('Kompensasi gangguan layanan pekan lalu.');
      await p.getByLabel('Alasan (wajib)').blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgGrant',
      png: 'admin/AdmDlgGrant.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-dlg-extend',
    app: 'admin',
    path: `/users/${RAKA.user.id}/subscriptions`,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    mock: mockAccess,
    prepare: async (p) => {
      await p.getByRole('button', { name: /^Perpanjang akses Salsa/ }).click();
      await p
        .getByLabel('Alasan (wajib)')
        .fill('Permintaan user karena tidak sempat memakai layanan.');
      await p.getByLabel('Alasan (wajib)').blur();
    },
    // the board measured with the fallback font comes out 21 px short; its real height is 528
    refHeight: 528,
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgExtend',
      png: 'admin/AdmDlgExtend.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  {
    name: 'admin-dlg-revoke',
    app: 'admin',
    path: `/users/${RAKA.user.id}/subscriptions`,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    mock: mockAccess,
    prepare: async (p) => {
      await p.getByRole('button', { name: /^Cabut akses Salsa/ }).click();
      await p.getByLabel('Alasan pencabutan (wajib)').fill('Pelanggaran ketentuan layanan.');
      await p.getByLabel('Alasan pencabutan (wajib)').blur();
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board: 'AdmDlgRevoke',
      png: 'admin/AdmDlgRevoke.png',
      locate: (p) => p.locator('[role=dialog]'),
    },
  },
  ...(
    [
      ['admin-subs-toast-granted', 'AdmUserSubsGranted', 'diberikan hingga', 'grant'],
      ['admin-subs-toast-extended', 'AdmUserSubsExtended', 'diperpanjang hingga', 'extend'],
      ['admin-subs-toast-revoked', 'AdmUserSubsRevoked', 'dicabut', 'revoke'],
    ] as const
  ).map(([name, board, text, action]): Item => ({
    name,
    app: 'admin',
    path: `/users/${RAKA.user.id}/subscriptions`,
    viewport: { width: 1440, height: 900 },
    scale: 1,
    mock: mockAccess,
    prepare: async (p) => {
      if (action === 'grant') {
        await p.getByRole('button', { name: 'Berikan Akses' }).click();
        await p.getByRole('dialog').getByLabel('Creator', { exact: true }).waitFor();
        await p.getByLabel('Alasan (wajib)').fill('x');
        await p.getByRole('button', { name: 'Berikan Akses' }).last().click();
      } else {
        const name = action === 'extend' ? /^Perpanjang akses Salsa/ : /^Cabut akses Salsa/;
        await p.getByRole('button', { name }).click();
        await p.getByLabel(/^Alasan/).fill('x');
        await p
          .getByRole('dialog')
          .getByRole('button', { name: action === 'extend' ? 'Perpanjang Akses' : 'Cabut Akses' })
          .click();
      }
      await p.getByRole('status').filter({ hasText: text }).waitFor();
    },
    actual: (p) => p.getByRole('status').filter({ hasText: text }),
    reference: { board, png: `admin/${board}.png`, locate: (p) => p.locator('[role=status]') },
  })),
  // ---- admin login (AdmLogin + AdmLoginStates) ----
  {
    name: 'admin-login-1440',
    app: 'admin',
    path: '/login',
    viewport: { width: 1440, height: 860 },
    scale: 1,
    signedOut: true,
    actual: (p) => p.locator('main > div'),
    reference: {
      board: 'AdmLogin',
      png: 'admin/AdmLogin.png',
      locate: (p) => p.locator('div[style*="width:440px"]'),
    },
    prepare: async (p) => {
      await fillLogin(p, 'abcdefghij');
    },
  },
  ...loginStates,
  // ---- Mini App foundation (Main / CrMain) ----
  {
    name: 'miniapp-buttons',
    app: 'miniapp',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 1,
    actual: (p) => p.locator('[data-preview-section="buttons"]'),
    reference: { board: 'Main', png: 'miniapp/Main.png', locate: byText('Tombol') },
  },
  {
    name: 'miniapp-nav-customer',
    app: 'miniapp',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 2,
    actual: (p) => p.locator('[data-preview-section="bottom-nav-customer"] nav'),
    reference: { board: 'Chats', png: 'miniapp/Chats.png', locate: (p) => p.locator('nav') },
  },
  {
    name: 'miniapp-nav-creator',
    app: 'miniapp',
    path: '/__preview',
    viewport: { width: 1440, height: 900 },
    scale: 2,
    actual: (p) => p.locator('[data-preview-section="bottom-nav-creator"] nav'),
    reference: { board: 'CrInbox', png: 'miniapp/CrInbox.png', locate: (p) => p.locator('nav') },
  },
  // ---- Mini App login (AuthLogin, AuthOutside, AuthStates) ----
  {
    name: 'miniapp-auth-login',
    app: 'miniapp',
    path: '/',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'login',
    actual: (p) => p.locator('main'),
    // The board also carries a DEMO strip over the top 44 px, which is not a product feature.
    reference: { board: 'AuthLogin', png: 'miniapp/AuthLogin.png', locate: authBoard },
  },
  {
    name: 'miniapp-auth-outside',
    app: 'miniapp',
    path: '/',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'outside',
    actual: (p) => p.locator('main'),
    reference: { board: 'AuthOutside', png: 'miniapp/AuthOutside.png', locate: authBoard },
  },
  ...authStates,
  // ---- Blocked account: NO BOARD EXISTS (design gap). Placeholder copy on the 'Belum bisa masuk'
  // layout; the reference is the AuthStates card 2 so spacing and structure can be eyeballed. The
  // icon and the text differ on purpose, so this is a capture to look at, not a pixel match. ----
  {
    name: 'miniapp-auth-blocked-placeholder',
    app: 'miniapp',
    path: '/',
    viewport: { width: 390, height: 760 },
    scale: 1,
    session: 'blocked',
    actual: (p) => p.locator('main'),
    reference: {
      board: 'AuthStates',
      png: 'miniapp/AuthStates.png',
      locate: authStateCard('2 · Gagal, dengan retry'),
    },
  },
  // ---- Creator deep link: unavailable (StatesProfile, 4th card) ----
  {
    name: 'miniapp-creator-link-tidak-tersedia',
    app: 'miniapp',
    path: '/creators/zzzzzzzz',
    viewport: { width: 390, height: 700 },
    scale: 1,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/creators/by-code/**', (r) =>
        r.fulfill({ status: 404, json: envelope('CREATOR_NOT_FOUND') }),
      );
    },
    // Wait for the resolved state: the loading screen has its own <main> that gets replaced.
    prepare: (p) => p.getByRole('heading', { name: 'Creator tidak tersedia' }).waitFor(),
    actual: (p) => p.locator('main'),
    reference: {
      board: 'StatesProfile',
      png: 'miniapp/StatesProfile.png',
      // The heading text also sits inside the card, so take the first match (the label).
      locate: (p) =>
        p.locator(`xpath=(//div[text()='Creator tidak tersedia'])[1]/following-sibling::div[1]`),
    },
  },
  // ---- Explore (US-022): the whole board, nav included (no search box, no category line: gaps) ----
  {
    name: 'miniapp-explore',
    app: 'miniapp',
    path: '/explore',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/creators?*', (r) =>
        r.fulfill({
          status: 200,
          json: {
            items: [
              {
                public_code: 'salsa234',
                display_name: 'Salsa Maheswari',
                bio: 'Suka masak sederhana, pasar pagi, dan cerita kecil di balik meja makan. Menulis resep yang bisa dicoba di dapur kecil.',
                avatar_url: null,
                access: 'ACTIVE',
              },
              {
                public_code: 'dinda234',
                display_name: 'Dinda Prameswari',
                bio: 'Memotret kota dan cahaya pagi. Berbagi proses foto, cerita perjalanan, dan tips kamera untuk pemula.',
                avatar_url: null,
                access: 'PENDING',
              },
              {
                public_code: 'kirana23',
                display_name: 'Kirana Larasati',
                bio: 'Pelatih kebugaran yang percaya pada kebiasaan kecil. Berbagi latihan singkat, catatan pemulihan, dan rutinitas pagi.',
                avatar_url: null,
                access: 'EXPIRED',
              },
            ],
            total: 3,
            page: 1,
            page_size: 20,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Salsa Maheswari').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'Explore',
      png: 'miniapp/Explore.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Chat list (US-027): `Chats` (whole board, nav included) and the three `StatesChats` panels ----
  {
    name: 'miniapp-chats',
    app: 'miniapp',
    path: '/chats',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      // The bottom-nav badge of the board: the server total is 2.
      await p.route('**/v1/chats/unread', (r) =>
        r.fulfill({ status: 200, json: { unread_total: 2 } }),
      );
      await p.route('**/v1/chats?*', (r) =>
        r.fulfill({
          status: 200,
          json: {
            items: [
              {
                conversation_id: '44444444-0000-4000-8000-000000000001',
                public_code: 'salsa234',
                display_name: 'Salsa Maheswari',
                avatar_url: null,
                last_message: {
                  preview: 'Gagal pertama itu wajar kok. Mulai dari adonan yang agak basah dulu.',
                  at: new Date(Date.now() - 60_000).toISOString(),
                  media_kind: null,
                },
                unread_count: 2,
                access: 'ACTIVE',
              },
              {
                conversation_id: '44444444-0000-4000-8000-000000000002',
                public_code: 'kirana23',
                display_name: 'Kirana Larasati',
                avatar_url: null,
                last_message: {
                  preview: 'Sampai ketemu di sesi berikutnya ya.',
                  at: '2026-11-06T09:32:00.000Z',
                  media_kind: null,
                },
                unread_count: 0,
                access: 'EXPIRED',
              },
            ],
            next_cursor: null,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Kirana Larasati').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'Chats',
      png: 'miniapp/Chats.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  ...(
    [
      ['miniapp-chats-loading', 'Loading', 'loading'],
      ['miniapp-chats-empty', 'Kosong', 'empty'],
      ['miniapp-chats-error', 'Error, dengan retry', 'error'],
    ] as const
  ).map(([name, label, kind]): Item => ({
    name,
    app: 'miniapp',
    path: '/chats',
    viewport: { width: 390, height: 844 },
    scale: 1,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/chats?*', (r) =>
        kind === 'loading'
          ? new Promise(() => undefined) // never answers: the skeleton stays
          : kind === 'empty'
            ? r.fulfill({ status: 200, json: { items: [], next_cursor: null } })
            : r.fulfill({ status: 500, json: envelope('INTERNAL_ERROR') }),
      );
    },
    prepare: async (p) => {
      if (kind === 'empty') await p.getByText('Belum ada percakapan').waitFor();
      if (kind === 'error') await p.getByText('Chat gagal dimuat').waitFor();
      if (kind === 'loading') await p.getByRole('status', { name: 'Memuat percakapan…' }).waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'StatesChats',
      png: 'miniapp/StatesChats.png',
      locate: (p) => p.locator(`xpath=(//div[text()='${label}'])[1]/following-sibling::div[1]`),
    },
  })),
  // ---- Langganan (US-025): the whole board, nav included; the Chat badge "2" is the chat stories' ----
  {
    name: 'miniapp-subscriptions',
    app: 'miniapp',
    path: '/subscriptions',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/subscriptions', (r) =>
        r.fulfill({
          status: 200,
          json: {
            items: [
              {
                public_code: 'salsa234',
                display_name: 'Salsa Maheswari',
                avatar_url: null,
                access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
                creator_available: true,
                conversation_id: null,
              },
              {
                public_code: 'dinda234',
                display_name: 'Dinda Prameswari',
                avatar_url: null,
                access: {
                  state: 'PENDING',
                  requested_at: '2026-11-13T03:42:00.000Z',
                  request_type: 'TRIAL',
                },
                creator_available: true,
                conversation_id: null,
              },
              {
                public_code: 'kirana23',
                display_name: 'Kirana Larasati',
                avatar_url: null,
                access: { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
                creator_available: true,
                conversation_id: null,
              },
            ],
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Kirana Larasati').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'Subscriptions',
      png: 'miniapp/Subscriptions.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Creator inbox (US-028): the board has a search box, Manual / Perlu Perhatian chips, AI row chips and a nav badge that are not built (expected differences) ----
  {
    name: 'miniapp-inbox',
    app: 'miniapp',
    path: '/inbox',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
      await mockInbox(p, inboxBoardAnswer);
      // The Inbox tab badge of the board (registered last, so it wins over the glob above).
      await p.route('**/v1/creator/inbox/unread', (r) =>
        r.fulfill({ status: 200, json: { unread_conversations: 2 } }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Nadia Kusuma').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrInbox',
      png: 'miniapp/CrInbox.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  ...(
    [
      [
        'loading',
        0,
        async (p: Page) => {
          await p.route('**/v1/creator/inbox**', () => undefined);
        },
        async (p: Page) => p.getByRole('status', { name: 'Memuat' }).waitFor(),
      ],
      [
        'empty',
        1,
        (p: Page) => mockInbox(p, { items: [], next_cursor: null, unread_conversations: 0 }),
        async (p: Page) => p.getByText('Belum ada percakapan').waitFor(),
      ],
      [
        'error',
        2,
        async (p: Page) => {
          await p.route('**/v1/creator/inbox**', (r) => r.abort('connectionrefused'));
        },
        async (p: Page) => p.getByText('Inbox gagal dimuat').waitFor(),
      ],
      [
        'offline',
        3,
        async (p: Page) => {
          await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
          await mockInbox(p, {
            items: inboxBoardAnswer.items.slice(0, 2),
            next_cursor: null,
            unread_conversations: 2,
          });
        },
        async (p: Page) => {
          await p.getByText('Bayu Setiawan').waitFor();
          await p.context().setOffline(true);
          await p.getByText('Koneksi terputus').waitFor();
        },
      ],
    ] as const
  ).map(([state, nth, mock, prepare]): Item => ({
    name: `miniapp-inbox-${state}`,
    app: 'miniapp',
    path: '/inbox',
    viewport: { width: 390, height: 844 },
    scale: 1,
    session: 'creator',
    mock,
    prepare,
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrStatesInbox',
      png: 'miniapp/CrStatesInbox.png',
      locate: (p) => p.locator('div[style*="width:390px"][style*="border-radius:28px"]').nth(nth),
    },
  })),
  // ---- Creator gallery (US-032): the boards' illustrations are replaced by a flat stand-in image; the "DEMO" strip of CrGalleryUploading is not product ----
  ...(
    [
      ['', 'CrGallery', 'gallery', null],
      ['-uploading', 'CrGalleryUploading', 'gallery', 'uploading'],
      ['-done', 'CrGalleryDone', 'gallery', 'done'],
    ] as const
  ).map(([suffix, board, , flow]): Item => ({
    name: `miniapp-gallery${suffix}`,
    app: 'miniapp',
    path: '/gallery',
    viewport: { width: 390, height: board === 'CrGallery' ? 980 : 1040 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await mockGallery(p, galleryAssets(12), 12);
      if (flow) await mockUploadFlow(p, flow);
    },
    prepare: async (p) => {
      await p.getByText('12 foto dan video').waitFor();
      if (flow) {
        await p.setInputFiles('[data-testid="file-input"]', {
          name: 'foto.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(2000, 1),
        });
        if (flow === 'uploading') await p.getByText('64%').waitFor();
        else await p.getByText('Baru').waitFor();
      }
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  ...(
    [
      [
        'empty',
        0,
        (p: Page) => mockGallery(p, [], 0),
        async (p: Page) => p.getByText('Galeri masih kosong').waitFor(),
      ],
      [
        'loading',
        1,
        async (p: Page) => {
          await p.route('**/v1/creator/gallery**', () => undefined);
        },
        async (p: Page) => p.getByRole('status', { name: 'Memuat' }).waitFor(),
      ],
      [
        'failed',
        2,
        async (p: Page) => {
          await mockGallery(p, galleryAssets(8), 8);
          await mockUploadFlow(p, 'failed');
        },
        async (p: Page) => {
          await p.getByText('8 foto dan video').waitFor();
          await p.setInputFiles('[data-testid="file-input"]', {
            name: 'foto.jpg',
            mimeType: 'image/jpeg',
            buffer: Buffer.alloc(2000, 1),
          });
          await p.getByText('Unggahan gagal', { exact: true }).waitFor();
        },
      ],
    ] as const
  ).map(([state, nth, mock, prepare]): Item => ({
    name: `miniapp-gallery-${state}`,
    app: 'miniapp',
    path: '/gallery',
    viewport: { width: 390, height: 760 },
    scale: 1,
    session: 'creator',
    mock,
    prepare,
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrStatesGallery',
      png: 'miniapp/CrStatesGallery.png',
      locate: (p) => p.locator('div[style*="width:390px"][style*="border-radius:28px"]').nth(nth),
    },
  })),
  // ---- Creator gallery viewer (US-033): the board art is a flat stand-in; the video is a 2 s fixture, so it shows 0:00 and not playing ----
  ...(
    [
      ['photo', 'CrViewerPhoto', galleryAsset(12, null), 1],
      ['video', 'CrViewerVideo', galleryAsset(11, 48), 2],
    ] as const
  ).map(([kind, board, asset, position]): Item => ({
    name: `miniapp-gallery-viewer-${kind}`,
    app: 'miniapp',
    path: `/gallery/${asset.id}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await mockGallery(p, galleryAssets(12), 12);
      await p.route('**/v1/dev-storage/m/o-**', (r) =>
        kind === 'video'
          ? r.fulfill({
              status: 200,
              contentType: 'video/webm',
              body: readFileSync(new URL('../fixtures/viewer-video.webm', import.meta.url)),
            })
          : r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
      );
      await p.route(`**/v1/creator/gallery/${asset.id}`, (r) =>
        r.fulfill({
          status: 200,
          json: {
            asset,
            original: {
              url: `http://localhost:3000/v1/dev-storage/m/o-${asset.id}?s=x`,
              expires_at: '2026-11-18T03:05:00.000Z',
            },
            uploaded_at: kind === 'photo' ? '2026-11-11T23:41:00.000Z' : '2026-11-10T23:41:00.000Z',
            position,
            total: 12,
            previous_id: position > 1 ? galleryAsset(12, null).id : null,
            next_id: position === 1 ? galleryAsset(11, 48).id : galleryAsset(10, null).id,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText(`${position} / 12`).waitFor();
      await p.getByText(/Diunggah/).waitFor();
      if (kind === 'video') await p.waitForTimeout(400);
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Creator sends media (US-036): the boards' AI header chip, Manual / Aktifkan AI panel, takeover note and "Mengirim akan mengambil alih" line are Phase F (expected differences) ----
  ...(
    [
      ['attach', 'CrAttach', 'sheet'],
      ['pick', 'CrChatPick', 'pick'],
      ['preview', 'CrChatPreview', 'preview'],
      ['upload', 'CrChatUpload', 'upload'],
      ['sent', 'CrChatSent', 'sent'],
    ] as const
  ).map(([name, board, step]): Item => ({
    name: `miniapp-cr-chat-${name}`,
    app: 'miniapp',
    path: `/inbox/${CR_CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
      await mockGallery(p, galleryAssets(12), 12);
      await mockUploadFlow(p, 'done');
      await p.route(`**/v1/creator/conversations/${CR_CHAT_ID}/messages**`, (r) =>
        r.request().method() === 'POST'
          ? r.fulfill({
              status: 201,
              json: {
                message: {
                  ...crChatMsg(
                    2,
                    'ME',
                    'Ini tepung yang kumaksud, gampang dicari.',
                    '2026-11-17T02:25:00.000Z',
                  ),
                  type: 'MEDIA',
                  attachments: [
                    {
                      id: galleryAsset(12, null).id,
                      kind: 'PHOTO',
                      duration_seconds: null,
                      thumbnail_url: galleryAsset(12, null).thumbnail_url,
                    },
                  ],
                },
              },
            })
          : r.fulfill({
              status: 200,
              json: crChatPage('ACTIVE', 'Rani Anggraini', [
                crChatMsg(
                  1,
                  'CUSTOMER',
                  'Oke, aku coba. Boleh minta rekomendasi tepungnya?',
                  '2026-11-17T02:20:00.000Z',
                ),
              ]),
            }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Rani Anggraini').first().waitFor();
      await p.getByRole('button', { name: 'Lampirkan media' }).click();
      await p.getByRole('dialog', { name: 'Kirim media ke Rani' }).waitFor();
      if (step === 'upload') {
        await p.setInputFiles('[data-testid="attach-file-input"]', {
          name: 'foto.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(2000, 1),
        });
        await p.waitForFunction(() =>
          [...document.querySelectorAll('button')].some(
            (b) => b.textContent?.trim() === 'Kirim' && !b.disabled,
          ),
        );
      } else if (step !== 'sheet') {
        await p.getByRole('button', { name: /Pilih Galeri/ }).click();
        await p.getByText('Pilih satu foto atau video dari galeri.').waitFor();
        await p.getByRole('button', { name: 'Pilih foto' }).first().click();
        if (step !== 'pick') {
          await p.getByRole('button', { name: 'Lanjut' }).click();
          await p.getByText('Kirim ke Rani Anggraini').waitFor();
        }
        if (step === 'sent') {
          await p
            .getByPlaceholder('Tulis pesan (opsional)')
            .fill('Ini tepung yang kumaksud, gampang dicari.');
          await p.getByRole('button', { name: 'Kirim', exact: true }).click();
          await p.getByText('Media terkirim').waitFor();
        }
      }
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Creator broadcast (US-038): the boards' illustrations are replaced by a flat stand-in image; the unread badge on the Inbox tab is a fixture of the boards ----
  ...(
    [
      ['empty', 'CrBroadcast', 844, 'empty'],
      ['pick', 'CrBroadcastPick', 844, 'pick'],
      ['ready', 'CrBroadcastReady', 940, 'ready'],
      ['upload', 'CrBroadcastUpload', 940, 'upload'],
      ['upload-saved', 'CrBroadcastUploadSaved', 940, 'saved'],
      ['confirm', 'CrBroadcastConfirm', 844, 'confirm'],
      ['done', 'CrBroadcastDone', 844, 'done'],
    ] as const
  ).map(([name, board, height, step]): Item => ({
    name: `miniapp-broadcast-${name}`,
    app: 'miniapp',
    path: '/broadcast',
    viewport: { width: 390, height },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await mockGallery(p, galleryAssets(12), 12);
      await mockUploadFlow(p, 'done');
      await p.route('**/v1/creator/broadcasts', (r) =>
        r.fulfill({
          status: 201,
          json: {
            id: '8d0e5f5c-1b6a-4f55-9a86-0c2a6f1d7e01',
            status: 'QUEUED',
            created_at: '2026-11-21T10:00:00.000Z',
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Pilih media untuk dikirim').waitFor();
      if (step === 'empty') return;
      if (step === 'upload' || step === 'saved') {
        await p.setInputFiles('[data-testid="broadcast-file-input"]', {
          name: 'foto.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(2000, 1),
        });
        await p.getByRole('checkbox', { name: 'Simpan juga ke galeri' }).waitFor();
        if (step === 'saved') await p.getByRole('checkbox').check();
        return;
      }
      await p.getByRole('button', { name: /Pilih Galeri/ }).click();
      await p.getByText('Pilih satu foto atau video dari galeri.').waitFor();
      await p.getByRole('button', { name: 'Pilih foto' }).first().click();
      if (step === 'pick') return;
      await p.getByRole('button', { name: 'Lanjut' }).click();
      await p.getByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.').waitFor();
      if (step === 'ready') return;
      await p.getByRole('button', { name: 'Kirim Broadcast' }).click();
      await p.getByRole('dialog').waitFor();
      if (step === 'confirm') return;
      await p.getByRole('dialog').getByRole('button', { name: 'Kirim Broadcast' }).click();
      await p.getByText('Broadcast terkirim ke semua subscriber aktif').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Creator welcome message (US-040): the boards' illustrations are replaced by a flat stand-in image ----
  ...(
    [
      ['empty', 'CrWelcome', 1180, 'empty'],
      ['pick', 'CrWelcomePick', 844, 'pick'],
      ['gallery', 'CrWelcomeGallery', 1180, 'gallery'],
      ['upload', 'CrWelcomeUpload', 1180, 'upload'],
    ] as const
  ).map(([name, board, height, step]): Item => ({
    name: `miniapp-welcome-${name}`,
    app: 'miniapp',
    path: '/settings/welcome',
    viewport: { width: 390, height },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await mockGallery(p, galleryAssets(12), 12);
      await mockUploadFlow(p, 'done');
      await p.route('**/v1/creator/welcome-message', (r) =>
        r.fulfill({
          status: 200,
          json: {
            enabled: true,
            body: 'Halo, selamat datang! Terima kasih sudah bergabung. Di sini kamu bisa tanya apa saja soal masak dan roti. Aku senang kenalan sama kamu.',
            media: null,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Belum ada media').waitFor();
      if (step === 'empty') return;
      if (step === 'upload') {
        await p.setInputFiles('[data-testid="welcome-file-input"]', {
          name: 'foto.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.alloc(2000, 1),
        });
        await p
          .getByText('Media ini hanya tersimpan di pesan selamat datang. Tidak masuk ke galeri.')
          .waitFor();
        return;
      }
      await p.getByRole('button', { name: /Pilih Galeri/ }).click();
      await p.getByText('Pilih satu foto atau video dari galeri.').waitFor();
      await p.getByRole('button', { name: 'Pilih foto' }).first().click();
      if (step === 'pick') return;
      await p.getByRole('button', { name: 'Lanjut' }).click();
      await p.getByText('Memakai media yang sama dari galeri. Tidak ada salinan baru.').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Customer chat viewer (US-037) ----
  ...(
    [
      ['photo', 'MediaPhoto', 1, 'Versi pedas buat akhir pekan ini.', 'PHOTO'],
      ['video', 'MediaVideo', 2, 'Latihan menguleni adonan roti sobek.', 'VIDEO'],
    ] as const
  ).map(([kind, board, position, body, mediaKind]): Item => ({
    name: `miniapp-chat-viewer-${kind}`,
    app: 'miniapp',
    path: `/chats/${CHAT_ID}/media/77777777-0000-4000-8000-${String(position === 1 ? 1 : 4).padStart(12, '0')}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
      await mockChatRead(p);
      await p.route('**/v1/dev-storage/m/o-**', (r) =>
        mediaKind === 'VIDEO'
          ? r.fulfill({
              status: 200,
              contentType: 'video/webm',
              body: readFileSync(new URL('../fixtures/viewer-video.webm', import.meta.url)),
            })
          : r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
      );
      await p.route('**/v1/dev-storage/m/t**', (r) =>
        r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
      );
      await p.route(`**/v1/chats/${CHAT_ID}/messages**`, (r) =>
        r.fulfill({
          status: 200,
          json: chatPage(
            'ACTIVE',
            [
              chatMediaMsg(4, body, 'VIDEO', '2026-11-17T02:16:00.000Z'),
              chatMediaMsg(1, body, 'PHOTO', '2026-11-17T02:16:00.000Z'),
            ],
            'Salsa Maheswari',
            0,
          ),
        }),
      );
      await p.route(`**/v1/chats/${CHAT_ID}/media/**`, (r) => {
        const id = new URL(r.request().url()).pathname.split('/').at(-1) ?? '';
        return r.fulfill({
          status: 200,
          json: {
            item: {
              id,
              kind: mediaKind,
              duration_seconds: mediaKind === 'VIDEO' ? 42 : null,
              thumbnail_url: `http://localhost:3000/v1/dev-storage/m/t-${id}`,
            },
            original: {
              url: `http://localhost:3000/v1/dev-storage/m/o-${id}?s=x`,
              expires_at: '2026-11-17T05:05:00.000Z',
            },
            message: { body, created_at: '2026-11-17T02:16:00.000Z' },
            creator: { display_name: 'Salsa Maheswari' },
            position,
            total: 2,
            previous_id: position === 2 ? '77777777-0000-4000-8000-000000000001' : null,
            next_id: position === 1 ? '77777777-0000-4000-8000-000000000004' : null,
          },
        });
      });
    },
    prepare: async (p) => {
      await p.getByText(`${position} / 2`).waitFor();
      await p.getByText(/Hari ini, 09\.16 WIB/).waitFor();
      if (mediaKind === 'VIDEO') await p.waitForTimeout(400);
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Subscriber viewer (US-034): the boards show the chat viewer's footer (avatar, message, time); here it is "{creator} · Diunggah {date}" ----
  ...(
    [
      ['photo', 'MediaPhoto', 12, 1],
      ['video', 'MediaVideo', 11, 2],
    ] as const
  ).map(([kind, board, n, position]): Item => ({
    name: `miniapp-customer-gallery-viewer-${kind}`,
    app: 'miniapp',
    path: `/creators/salsa234/gallery/${galleryAsset(n, kind === 'video' ? 48 : null).id}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      const asset = galleryAsset(n, kind === 'video' ? 48 : null);
      await p.route('**/v1/creators/by-code/salsa234', (r) =>
        r.fulfill({
          status: 200,
          json: {
            public_code: 'salsa234',
            display_name: 'Salsa Maheswari',
            bio: null,
            avatar_url: null,
            conversation_id: null,
            access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
          },
        }),
      );
      await p.route('**/v1/creators/by-code/salsa234/gallery**', (r) =>
        r.fulfill({ status: 200, json: customerGalleryAnswer(12) }),
      );
      await p.route('**/v1/dev-storage/m/o-**', (r) =>
        kind === 'video'
          ? r.fulfill({
              status: 200,
              contentType: 'video/webm',
              body: readFileSync(new URL('../fixtures/viewer-video.webm', import.meta.url)),
            })
          : r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
      );
      await p.route(`**/v1/creators/by-code/salsa234/gallery/${asset.id}`, (r) =>
        r.fulfill({
          status: 200,
          json: {
            item: {
              id: asset.id,
              kind: asset.kind,
              duration_seconds: asset.duration_seconds,
              thumbnail_url: asset.thumbnail_url,
            },
            original: {
              url: `http://localhost:3000/v1/dev-storage/m/o-${asset.id}?s=x`,
              expires_at: '2026-11-18T03:05:00.000Z',
            },
            uploaded_at: '2026-11-11T23:41:00.000Z',
            position,
            total: 12,
            previous_id: position > 1 ? galleryAsset(12, null).id : null,
            next_id: galleryAsset(n - 1, null).id,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText(`${position} / 12`).waitFor();
      await p.getByText(/Diunggah/).waitFor();
      if (kind === 'video') await p.waitForTimeout(400);
    },
    actual: (p) => p.getByRole('dialog'),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Creator conversation (US-029): the board's Manual / AI panel, the takeover and pause notes, the composer hint, the attach button and the AI card are Phase D / F (expected differences) ----
  {
    name: 'miniapp-cr-chat-manual',
    app: 'miniapp',
    path: `/inbox/${CR_CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
      await p.route(`**/v1/creator/conversations/${CR_CHAT_ID}/messages**`, (r) =>
        r.fulfill({
          status: 200,
          json: crChatPage('ACTIVE', 'Rani Anggraini', [
            crChatMsg(
              2,
              'ME',
              'Rekomendasiku tepung protein tinggi yang mudah dicari di supermarket.',
              '2026-11-17T02:23:00.000Z',
            ),
            crChatMsg(
              1,
              'CUSTOMER',
              'Oke, aku coba. Boleh minta rekomendasi tepungnya?',
              '2026-11-17T02:20:00.000Z',
            ),
          ]),
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Rani Anggraini').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrChatManual',
      png: 'miniapp/CrChatManual.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-cr-chat-expired',
    app: 'miniapp',
    path: `/inbox/${CR_CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.route(`**/v1/creator/conversations/${CR_CHAT_ID}/messages**`, (r) =>
        r.fulfill({
          status: 200,
          json: crChatPage('EXPIRED', 'Nadia Kusuma', [
            crChatMsg(2, 'ME', 'Sama-sama, Nadia. Senang kalau cocok.', '2026-11-06T09:25:00.000Z'),
            crChatMsg(
              1,
              'CUSTOMER',
              'Terima kasih banyak ya kak, resepnya enak.',
              '2026-11-06T09:20:00.000Z',
            ),
          ]),
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Akses pelanggan telah berakhir.').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrChatExpired',
      png: 'miniapp/CrChatExpired.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-cr-customer',
    app: 'miniapp',
    path: `/inbox/${CR_CHAT_ID}/customer`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.route(`**/v1/creator/conversations/${CR_CHAT_ID}/customer`, (r) =>
        r.fulfill({
          status: 200,
          json: {
            customer: {
              display_name: 'Rani Anggraini',
              avatar_url: null,
              username: 'rani.anggraini',
            },
            access: { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z', ended_at: null },
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('@rani.anggraini · dari Telegram').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrCustomer',
      png: 'miniapp/CrCustomer.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Private chat (US-026, media bubbles US-037): the board's photo and video bubbles use stand-in artwork ----
  {
    name: 'miniapp-chat',
    app: 'miniapp',
    path: `/chats/${CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.clock.setFixedTime(new Date('2026-11-17T05:00:00.000Z'));
      let posts = 0;
      await mockChatRead(p);
      await p.route('**/v1/dev-storage/**', (r) =>
        r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
      );
      await p.route(`**/v1/chats/${CHAT_ID}/messages**`, (r) => {
        if (r.request().method() === 'POST') {
          posts += 1;
          // The first send stays "Mengirim…", the second one fails ("Belum terkirim").
          return posts === 1 ? undefined : r.abort('connectionrefused');
        }
        return r.fulfill({
          status: 200,
          json: chatPage(
            'ACTIVE',
            [
              chatMediaMsg(4, null, 'VIDEO', '2026-11-17T02:16:00.000Z'),
              chatMsg(
                3,
                'CREATOR',
                'Gagal pertama itu wajar kok. Mulai dari adonan yang agak basah dulu.',
                '2026-11-17T02:14:00.000Z',
              ),
              chatMsg(2, 'ME', 'Pengin coba bikin roti sobek.', '2026-11-17T02:05:00.000Z'),
              chatMediaMsg(
                1,
                'Versi pedas buat akhir pekan ini.',
                'PHOTO',
                '2026-11-16T11:02:00.000Z',
              ),
            ],
            'Salsa Maheswari',
            2,
          ),
        });
      });
    },
    prepare: async (p) => {
      await p.getByText('Salsa Maheswari').waitFor();
      const input = p.getByRole('textbox', { name: 'Tulis pesan' });
      await input.fill('Boleh minta daftar bahannya?');
      await input.press('Enter');
      await input.fill('Aku coba hari Minggu, ya.');
      await input.press('Enter');
      await p.getByText('Kirim Ulang').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'Chat',
      png: 'miniapp/Chat.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-chat-expired',
    app: 'miniapp',
    path: `/chats/${CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await mockChatRead(p);
      await p.route(`**/v1/chats/${CHAT_ID}/messages**`, (r) =>
        r.fulfill({
          status: 200,
          json: chatPage(
            'EXPIRED',
            [
              chatMsg(
                4,
                'CREATOR',
                'Sampai ketemu di sesi berikutnya ya.',
                '2026-11-06T09:32:00.000Z',
              ),
              chatMsg(
                3,
                'ME',
                'Makasih kak, aku coba pelan-pelan dulu.',
                '2026-11-06T09:30:00.000Z',
              ),
              chatMsg(2, 'CREATOR', 'Jadwal latihan minggu depan.', '2026-11-06T09:21:00.000Z'),
              chatMsg(
                1,
                'CREATOR',
                'Ini rangkuman latihan minggu ini. Jangan lupa istirahat cukup.',
                '2026-11-06T09:20:00.000Z',
              ),
            ],
            'Kirana Larasati',
            3,
          ),
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Minta Perpanjangan Akses').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'ChatExpired',
      png: 'miniapp/ChatExpired.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // The third phone of StatesAccess: the history is still loading.
  {
    name: 'miniapp-chat-loading',
    app: 'miniapp',
    path: `/chats/${CHAT_ID}`,
    viewport: { width: 390, height: 844 },
    scale: 1,
    session: 'user',
    mock: async (p) => {
      await p.route(`**/v1/chats/${CHAT_ID}/messages**`, () => undefined); // never answers
    },
    prepare: async (p) => {
      await p.getByText('Memuat riwayat…').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'StatesAccess',
      png: 'miniapp/StatesAccess.png',
      locate: (p) => p.locator('div[style*="width:390px"][style*="border-radius:28px"]').nth(2),
    },
  },
  // ---- Creator profile by access state (US-022): hero, status and the locked-gallery panel (no tile grid, no category line) ----
  ...(
    [
      [
        'miniapp-creator-guest',
        'CreatorGuest',
        'dinda234',
        'Dinda Prameswari',
        { state: 'GUEST' },
        'Minta Akses Uji Coba',
        840,
      ],
      [
        'miniapp-creator-pending',
        'CreatorPending',
        'dinda234',
        'Dinda Prameswari',
        { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
        'Permintaan akses terkirim',
        900,
      ],
      [
        'miniapp-creator-active',
        'CreatorActive',
        'salsa234',
        'Salsa Maheswari',
        { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
        'Buka Chat',
        0, // the whole board: the tile grid exists now (US-034)
      ],
      [
        'miniapp-creator-expired',
        'CreatorExpired',
        'kirana23',
        'Kirana Larasati',
        { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
        'Minta Perpanjangan Akses',
        940,
      ],
    ] as const
  ).map(([name, board, code, display, access, ready, cap]): Item => ({
    name,
    app: 'miniapp',
    path: `/creators/${code}`,
    viewport: { width: 390, height: board === 'CreatorActive' ? 1400 : 1700 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/creators/by-code/**', (r) =>
        r.fulfill({
          status: 200,
          json: {
            public_code: code,
            display_name: display,
            bio: BIOS[code],
            avatar_url: null,
            conversation_id: null,
            access,
          },
        }),
      );
      if (access.state === 'ACTIVE') {
        await p.route('**/v1/dev-storage/**', (r) =>
          r.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }),
        );
        await p.route('**/v1/creators/by-code/*/gallery**', (r) =>
          r.fulfill({ status: 200, json: customerGalleryAnswer(9) }),
        );
      }
    },
    prepare: async (p) => {
      await p.getByText(ready, { exact: false }).first().waitFor();
      if (access.state === 'ACTIVE')
        await p.getByRole('button', { name: 'Buka foto' }).first().waitFor();
    },
    ...(cap ? { cap } : {}),
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board,
      png: `miniapp/${board}.png`,
      locate: (p) => p.locator('div[style*="width:390px"][style*="height:"]').first(),
    },
  })),
  // ---- Access request result cards (US-023): the two StatesAccess panels' cards ----
  ...(
    [
      [
        'miniapp-access-approved',
        'Akses disetujui',
        { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
        { status: 'APPROVED', reviewed_at: '2026-11-17T02:00:00.000Z' },
      ],
      [
        'miniapp-access-rejected',
        'Permintaan belum bisa disetujui',
        { state: 'GUEST' },
        { status: 'REJECTED', reviewed_at: '2026-11-14T02:10:00.000Z' },
      ],
    ] as const
  ).map(([name, title, access, last_review]): Item => ({
    name,
    app: 'miniapp',
    path: '/creators/dinda234',
    viewport: { width: 390, height: 1200 },
    // The StatesAccess PNG is the whole 1340 px board at 1x; the card is 142 px tall (3 text lines).
    scale: 1,
    refHeight: 142,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/creators/by-code/**', (r) =>
        r.fulfill({
          status: 200,
          json: {
            public_code: 'dinda234',
            display_name: 'Dinda',
            bio: null,
            avatar_url: null,
            conversation_id: null,
            access,
            last_review,
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText(title, { exact: true }).waitFor();
    },
    actual: (p) => p.locator(`xpath=(//div[text()='${title}'])[1]/../..`),
    reference: {
      board: 'StatesAccess',
      png: 'miniapp/StatesAccess.png',
      locate: (p) => p.locator(`xpath=(//div[text()='${title}'])[1]/../..`),
    },
  })),
  // ---- Profile (US-007): the whole board, nav included ----
  {
    name: 'miniapp-profile',
    app: 'miniapp',
    path: '/profile',
    viewport: { width: 390, height: 1300 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/me', (r) =>
        r.fulfill({
          status: 200,
          json: { ...MINIAPP_USER, display_name: 'Maya Lestari', telegram_username: 'mayalestari' },
        }),
      );
      // US-043: the switches work now, so they wait for the server's (default) answer.
      await p.route('**/v1/me/notification-preferences', (r) =>
        r.fulfill({ status: 200, json: { messages_enabled: true, show_content: false } }),
      );
    },
    prepare: async (p) => {
      await p.getByRole('switch', { name: 'Notifikasi pesan' }).waitFor();
      await p.waitForFunction(() =>
        [...document.querySelectorAll('[role="switch"]')].every(
          (el) => !(el as HTMLButtonElement).disabled,
        ),
      );
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'Profile',
      png: 'miniapp/Profile.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Edit profile (US-007): EditProfile and the four EditStates cards ----
  {
    name: 'miniapp-edit-profile',
    app: 'miniapp',
    path: '/profile/edit',
    viewport: { width: 390, height: 960 },
    scale: 2,
    session: 'user',
    mock: mockEditProfileUser,
    actual: (p) => p.locator('#root > form'),
    reference: {
      board: 'EditProfile',
      png: 'miniapp/EditProfile.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  ...editStates,
  // ---- Creator request (US-010): CreatorRequest, the three RequestStates cards, CreatorRequestBlocked ----
  {
    name: 'miniapp-creator-request',
    app: 'miniapp',
    path: '/profile/creator-request',
    viewport: { width: 390, height: 1180 },
    scale: 2,
    session: 'user',
    mock: (p) => mockCreatorRequest(p),
    prepare: async (p) => {
      await p.getByLabel('Nama creator').waitFor();
    },
    actual: (p) => p.locator('#root > form'),
    reference: {
      board: 'CreatorRequest',
      png: 'miniapp/CreatorRequest.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  ...requestStates,
  {
    name: 'miniapp-creator-request-blocked',
    app: 'miniapp',
    path: '/profile/creator-request',
    viewport: { width: 390, height: 1180 },
    scale: 2,
    session: 'user',
    mock: (p) =>
      mockCreatorRequest(p, {
        blocked: { creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T00:00:00.000Z' },
      }),
    prepare: async (p) => {
      await p.getByText('Belum bisa mengajukan').waitFor();
    },
    actual: (p) => p.locator('#root > form'),
    reference: {
      board: 'CreatorRequestBlocked',
      png: 'miniapp/CreatorRequestBlocked.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-profile-blocked',
    app: 'miniapp',
    path: '/profile',
    viewport: { width: 390, height: 1300 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await p.route('**/v1/me', (r) =>
        r.fulfill({
          status: 200,
          json: {
            ...MINIAPP_USER,
            display_name: 'Raka Putra',
            telegram_username: 'rakaputra',
          },
        }),
      );
      await p.route('**/v1/me/creator-request', (r) =>
        r.fulfill({
          status: 200,
          json: {
            request: null,
            blocked: { creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T00:00:00.000Z' },
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Langganan aktif: Salsa Maheswari').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'ProfileBlocked',
      png: 'miniapp/ProfileBlocked.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Creator request status (US-011): RequestPending, RequestRejected, CreatorRequestRetry, ProfilePending, ProfileRejected ----
  {
    name: 'miniapp-request-pending',
    app: 'miniapp',
    path: '/profile/creator-request/status',
    viewport: { width: 390, height: 800 },
    scale: 2,
    session: 'user',
    mock: (p) => mockCreatorRequest(p, { request: PENDING_REQUEST }),
    prepare: async (p) => {
      await p.getByText('Sedang Ditinjau').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    // The board's top 44 px is the DEMO strip ("bukan fitur produk"), which is not built.
    refTop: 44,
    reference: {
      board: 'RequestPending',
      png: 'miniapp/RequestPending.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-request-rejected',
    app: 'miniapp',
    path: '/profile/creator-request/status',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'user',
    mock: (p) => mockCreatorRequest(p, { request: REJECTED_REQUEST }),
    prepare: async (p) => {
      await p.getByText('Alasan dari admin').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'RequestRejected',
      png: 'miniapp/RequestRejected.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-creator-request-retry',
    app: 'miniapp',
    path: '/profile/creator-request',
    viewport: { width: 390, height: 1180 },
    scale: 2,
    session: 'user',
    mock: (p) => mockCreatorRequest(p, { request: REJECTED_REQUEST }),
    prepare: async (p) => {
      await p.getByText(/Alasan penolakan sebelumnya/).waitFor();
      // The board shows the rights statement already confirmed; the app starts unchecked.
      await p.getByRole('checkbox').check();
    },
    actual: (p) => p.locator('#root > form'),
    reference: {
      board: 'CreatorRequestRetry',
      png: 'miniapp/CreatorRequestRetry.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  ...(['pending', 'rejected'] as const).map((kind): Item => ({
    name: `miniapp-profile-${kind}`,
    app: 'miniapp',
    path: '/profile',
    viewport: { width: 390, height: 1300 },
    scale: 2,
    session: 'user',
    mock: async (p) => {
      await mockCreatorRequest(p, {
        request: kind === 'pending' ? PENDING_REQUEST : REJECTED_REQUEST,
      });
      await p.route('**/v1/me', (r) =>
        r.fulfill({
          status: 200,
          json: {
            ...MINIAPP_USER,
            display_name: 'Maya Lestari',
            telegram_username: 'mayalestari',
          },
        }),
      );
    },
    prepare: async (p) => {
      await p.getByText('Permintaan creator').waitFor();
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: kind === 'pending' ? 'ProfilePending' : 'ProfileRejected',
      png: `miniapp/${kind === 'pending' ? 'ProfilePending' : 'ProfileRejected'}.png`,
      locate: (p) => p.locator('body > div').first(),
    },
  })),
  // ---- Creator settings (US-008): CrSettings and CrEditProfile ----
  {
    name: 'miniapp-creator-settings',
    app: 'miniapp',
    path: '/settings',
    viewport: { width: 390, height: 1700 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      const profile = {
        ...MINIAPP_USER,
        role: 'CREATOR',
        display_name: 'Salsa Maheswari',
        telegram_username: 'salsa.maheswari',
        bio: 'Suka masak sederhana, pasar pagi, dan cerita kecil di balik me…',
      };
      await p.route('**/v1/me', (r) => r.fulfill({ status: 200, json: profile }));
      await p.route('**/v1/creator/settings', (r) =>
        r.fulfill({
          status: 200,
          json: {
            profile,
            public_code: 'salsa234',
            bio_link: 'https://t.me/CreatorChatBot?start=c_salsa234',
            // the board shows the welcome message row as "Aktif" (US-040)
            welcome_enabled: true,
          },
        }),
      );
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrSettings',
      png: 'miniapp/CrSettings.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-creator-edit-profile',
    app: 'miniapp',
    path: '/settings/profile',
    viewport: { width: 390, height: 960 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.route('**/v1/me', (r) =>
        r.fulfill({
          status: 200,
          json: {
            ...MINIAPP_USER,
            role: 'CREATOR',
            display_name: 'Salsa Maheswari',
            telegram_username: 'salsa.maheswari',
            bio: 'Suka masak sederhana, pasar pagi, dan cerita kecil di balik meja makan.',
          },
        }),
      );
    },
    actual: (p) => p.locator('#root > form'),
    reference: {
      board: 'CrEditProfile',
      png: 'miniapp/CrEditProfile.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  {
    name: 'miniapp-creator-timezone',
    app: 'miniapp',
    path: '/settings/timezone',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    mock: async (p) => {
      await p.route('**/v1/me', (r) =>
        r.fulfill({
          status: 200,
          json: { ...MINIAPP_USER, role: 'CREATOR', display_name: 'Salsa Maheswari' },
        }),
      );
    },
    actual: (p) => p.locator('#root > div').first(),
    reference: {
      board: 'CrTimezone',
      png: 'miniapp/CrTimezone.png',
      locate: (p) => p.locator('body > div').first(),
    },
  },
  // ---- Mini App shells at 390 x 844 ----
  {
    name: 'miniapp-shell-customer-nav',
    app: 'miniapp',
    path: '/chats',
    viewport: { width: 390, height: 844 },
    scale: 2,
    actual: (p) => p.getByRole('navigation', { name: 'Navigasi utama' }),
    reference: { board: 'Chats', png: 'miniapp/Chats.png', locate: (p) => p.locator('nav') },
  },
  {
    name: 'miniapp-shell-creator-nav',
    app: 'miniapp',
    path: '/inbox',
    viewport: { width: 390, height: 844 },
    scale: 2,
    session: 'creator',
    actual: (p) => p.getByRole('navigation', { name: 'Navigasi creator' }),
    reference: { board: 'CrInbox', png: 'miniapp/CrInbox.png', locate: (p) => p.locator('nav') },
  },
];

const results: Comparison[] = [];

/**
 * The admin pages sit behind login and the harness runs without the API, so the session check is
 * answered here: signed in (the shell sheets) or signed out (the login sheets).
 */
async function stubAdminSession(page: Page, signedOut: boolean) {
  await page.route('**/v1/admin/auth/me', (route) =>
    signedOut
      ? route.fulfill({ status: 401, json: envelope('UNAUTHENTICATED') })
      : route.fulfill({
          status: 200,
          json: {
            admin: {
              id: '3f2b8c1e-5d4a-4b7e-9c1a-2d3e4f5a6b7c',
              username: 'admin',
              role: 'Administrator',
            },
          },
        }),
  );
  await page.route('**/v1/admin/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: envelope('UNAUTHENTICATED') }),
  );
}

/**
 * The Mini App sheets run without the API and outside Telegram, so Telegram's WebApp object and the
 * two auth calls are stubbed here. This only drives the screens; it proves nothing about the API.
 */
async function stubMiniappSession(page: Page, session: MiniappSession) {
  // index.html loads Telegram's real script, which would replace the stubbed WebApp object.
  await page.route('https://telegram.org/**', (route) => route.abort());
  await page.addInitScript(
    ({ withTelegram, seen }) => {
      if (withTelegram) {
        (window as unknown as { Telegram: unknown }).Telegram = {
          WebApp: { initData: 'query_id=visual&hash=visual', ready() {}, expand() {} },
        };
      }
      if (seen) window.localStorage.setItem('cc_tg_seen', '1');
      else window.localStorage.removeItem('cc_tg_seen');
    },
    { withTelegram: session !== 'outside', seen: session !== 'login' },
  );
  const user = { ...MINIAPP_USER, role: session === 'creator' ? 'CREATOR' : 'USER' };
  await page.route('**/v1/auth/telegram', (route) => {
    if (session === 'connecting') return undefined; // never answers: stays on "Memuat"
    if (session === 'network') return route.abort('connectionrefused');
    if (session === 'blocked') {
      return route.fulfill({ status: 403, json: envelope('ACCOUNT_BLOCKED') });
    }
    if (session === 'expired') {
      return route.fulfill({ status: 401, json: envelope('TELEGRAM_AUTH_EXPIRED') });
    }
    return route.fulfill({
      status: 200,
      json: { access_token: 'visual-token', token_type: 'Bearer', expires_in: 3600, user },
    });
  });
  await page.route('**/v1/me', (route) => route.fulfill({ status: 200, json: user }));
}

async function run(browser: Browser, item: Item) {
  const context = await browser.newContext({
    viewport: item.viewport,
    deviceScaleFactor: item.scale,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    if (item.app === 'admin') await stubAdminSession(page, item.signedOut === true);
    if (item.app === 'miniapp' && !item.path.startsWith('/__preview')) {
      await stubMiniappSession(page, item.session ?? 'user');
    }
    await item.mock?.(page);
    await page.goto(`${item.app === 'admin' ? ADMIN_URL : MINIAPP_URL}${item.path}`);
    await page.evaluate(() => document.fonts.ready);
    await item.prepare?.(page);
    const target = item.actual(page).first();
    await target.waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);

    const box = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
    const ref = await boardRect(browser, item.reference.board, item.reference.locate);
    const height = item.cap ? Math.min(item.cap, box.height) : box.height;
    const refTop = item.refTop ?? 0;
    const refHeight =
      item.refHeight ?? (item.cap ? Math.min(item.cap, ref.rect.height) : ref.rect.height) - refTop;

    const actual = await page.screenshot({
      fullPage: true,
      clip: { x: box.x, y: box.y, width: box.width, height },
    });
    results.push(
      await compare(
        browser,
        item.name,
        {
          png: item.reference.png,
          boardWidth: ref.boardWidth,
          rect: { ...ref.rect, y: ref.rect.y + refTop, height: refHeight },
        },
        actual,
      ),
    );
  } finally {
    await context.close();
  }
}

for (const item of items) {
  test(item.name, async ({ browser }) => {
    await run(browser, item);
  });
}

test.afterAll(() => {
  writeReport(results);
});
