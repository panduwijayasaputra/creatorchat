import type { TelegramWebApp } from './webapp';

/**
 * Development only (imported behind `import.meta.env.DEV`, so it is not part of the production
 * bundle). Lets a browser outside Telegram act like the Mini App with initData signed by
 * `pnpm telegram:initdata`: open `http://localhost:5173/?tgdev=<initData>`. The API still validates
 * the signature for real, so this adds no way around the server checks.
 */
export function installDevInitData(
  search: string = window.location.search,
  target: Window = window,
): boolean {
  const initData = new URLSearchParams(search).get('tgdev');
  if (!initData || target.Telegram?.WebApp?.initData) return false;
  install(initData, target);
  return true;
}

function install(initData: string, target: Window): void {
  const webApp: TelegramWebApp = { initData, ready() {}, expand() {} };
  target.Telegram = { ...target.Telegram, WebApp: webApp };
}

const IDENTITY_KEY = 'tgdev-identity';

/**
 * Development only. Without `?tgdev=` and outside Telegram, asks the Vite dev server
 * (`/__dev/initdata`, see `dev-telegram-login.ts`) for freshly signed initData, so a plain browser
 * logs in. `?tgdev_id=&tgdev_name=&tgdev_username=` picks the account and is remembered for the tab;
 * without them the dev server's default test user is used. Any failure leaves the outside-Telegram screen.
 */
export async function installServerDevInitData(
  target: Window = window,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (target.Telegram?.WebApp?.initData) return false;
  const search = new URLSearchParams(target.location.search);
  const query = new URLSearchParams();
  for (const key of ['id', 'name', 'username']) {
    const value = search.get(`tgdev_${key}`);
    if (value) query.set(key, value);
  }
  try {
    if (query.size > 0) target.sessionStorage.setItem(IDENTITY_KEY, query.toString());
    else
      for (const [k, v] of new URLSearchParams(target.sessionStorage.getItem(IDENTITY_KEY) ?? ''))
        query.set(k, v);
  } catch {
    // Storage blocked: use this URL's identity only.
  }
  try {
    const response = await fetchFn(`/__dev/initdata?${query.toString()}`);
    const body = (await response.json()) as { initData?: string; error?: string };
    if (!response.ok || !body.initData) {
      console.warn('[dev] Telegram dev login unavailable:', body.error ?? response.status);
      return false;
    }
    install(body.initData, target);
    return true;
  } catch {
    return false;
  }
}
