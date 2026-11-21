import type { BotMessage } from './creator-result-message.js';

/** A Mini App path a bot button may open: letters, digits, `/`, `_`, `-` only (no query, dots or `//`). */
const PATH = /^\/[A-Za-z0-9/_-]{0,80}$/;

/**
 * Builds a bot message whose `web_app` button is always on the configured Mini App origin, optionally
 * with a path (a chat, the Langganan page). The path is appended to the origin as text, never
 * resolved as a URL, so `//host` cannot leave the origin. Returns `null` when the Mini App URL is
 * unset or malformed, or the path is not allowed, so the caller waits instead of sending a button
 * that goes nowhere.
 */
export function buildBotMessage(input: {
  text: string;
  buttonText: string;
  miniAppUrl: string | undefined;
  path?: string;
}): BotMessage | null {
  if (!input.miniAppUrl) return null;
  let base: URL;
  try {
    base = new URL(input.miniAppUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;

  const path = input.path ?? '/';
  if (!PATH.test(path) || path.startsWith('//')) return null;
  return { text: input.text, buttonText: input.buttonText, url: base.origin + path };
}
