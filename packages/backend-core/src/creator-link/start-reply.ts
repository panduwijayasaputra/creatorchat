import { creatorPath, StartPayloadSchema } from '@creatorchat/contracts';
import { BOT_COPY } from './bot-copy.js';

export interface StartReply {
  text: string;
  buttonText: string;
  /** The `web_app` button URL. Always on the configured Mini App origin. */
  url: string;
}

/**
 * Builds the reply to `/start [payload]`. A payload of the form `c_<code>` becomes the Mini App
 * route for that creator; everything else opens the app without a destination. The bot never looks
 * the creator up: the Mini App resolves the code on the server after login. Returns `null` when the
 * Mini App URL is not configured (the bot then stays silent).
 */
export function buildStartReply(input: {
  payload: string | undefined;
  miniAppUrl: string | undefined;
}): StartReply | null {
  if (!input.miniAppUrl) return null;
  let base: URL;
  try {
    base = new URL(input.miniAppUrl);
  } catch {
    return null;
  }
  const parsed = StartPayloadSchema.safeParse(input.payload?.trim());
  if (parsed.success) {
    const code = parsed.data.slice(2);
    const url = new URL(creatorPath(code), base.origin);
    // Defence in depth: the origin can never change, whatever the payload held.
    if (url.origin === base.origin) {
      return { text: BOT_COPY.creatorLink, buttonText: BOT_COPY.openButton, url: url.toString() };
    }
  }
  return { text: BOT_COPY.welcome, buttonText: BOT_COPY.openButton, url: base.origin + '/' };
}
