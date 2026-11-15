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
  const webApp: TelegramWebApp = { initData, ready() {}, expand() {} };
  target.Telegram = { ...target.Telegram, WebApp: webApp };
  return true;
}
