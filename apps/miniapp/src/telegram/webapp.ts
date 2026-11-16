/** The slice of Telegram's `window.Telegram.WebApp` this app uses (https://core.telegram.org/bots/webapps). */
export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  openTelegramLink?(url: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** What the auth code needs from Telegram; tests pass a fake. */
export interface TelegramEnv {
  /** The signed `initData` string, or `null` outside Telegram (no WebApp, or an empty string). */
  getInitData(): string | null;
  /** Tells Telegram the app is ready and asks for the full height. Safe to call outside Telegram. */
  signalReady(): void;
}

export const browserTelegram: TelegramEnv = {
  getInitData() {
    const initData = window.Telegram?.WebApp?.initData;
    return typeof initData === 'string' && initData.length > 0 ? initData : null;
  },
  signalReady() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready();
    webApp.expand();
  },
};

const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** Link to the bot ("Buka di Telegram"), or `null` when no valid username is configured. */
export function botUrl(username: string | undefined): string | null {
  const name = username?.trim().replace(/^@/, '');
  return name && BOT_USERNAME.test(name) ? `https://t.me/${name}` : null;
}

/** Opens a t.me link inside Telegram when the WebApp can, otherwise as a normal link in a new tab. */
export function openTelegramLink(url: string): void {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
