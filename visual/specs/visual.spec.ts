import { test, type Browser, type Locator, type Page } from '@playwright/test';
import { ADMIN_URL, MINIAPP_URL, boardRect, compare, writeReport, type Comparison } from '../lib';

/**
 * Captures regions of the running apps and lays each next to the same region of the design
 * handoff PNG. Output goes to visual/output (git-ignored). The diff percentage is informational:
 * the sheets are what gets reviewed.
 */

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
}

const byText = (text: string) => (page: Page) => page.locator(`xpath=//div[text()='${text}']/..`);
const afterLabel = (text: string) => (page: Page) =>
  page.locator(`xpath=//div[text()='${text}']/following-sibling::div[1]`);

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
    actual: (p) => p.locator('main'),
    reference: {
      board: 'StatesProfile',
      png: 'miniapp/StatesProfile.png',
      // The heading text also sits inside the card, so take the first match (the label).
      locate: (p) =>
        p.locator(`xpath=(//div[text()='Creator tidak tersedia'])[1]/following-sibling::div[1]`),
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

const MINIAPP_USER = {
  id: '5b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e11',
  telegram_id: '424242',
  role: 'USER',
  status: 'ACTIVE',
  display_name: 'Nadia Putri',
  telegram_username: 'nadia',
  avatar_url: null,
};

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
    const refHeight = item.cap ? Math.min(item.cap, ref.rect.height) : ref.rect.height;

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
          rect: { ...ref.rect, height: refHeight },
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
