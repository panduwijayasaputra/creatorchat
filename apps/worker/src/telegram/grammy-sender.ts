import type { BotMessage, SendOutcome, TelegramSender } from '@creatorchat/backend-core';
import { Api, GrammyError, HttpError } from 'grammy';

const TIMEOUT_SECONDS = 15;

/**
 * Turns whatever grammY threw into a `SendOutcome`. Error messages and causes are never copied:
 * a Telegram client error can echo the request URL, which contains the bot token.
 */
export function classifyTelegramError(error: unknown): SendOutcome {
  if (error instanceof GrammyError) {
    const code = error.error_code;
    if (code === 429) {
      const wait = error.parameters?.retry_after;
      return { kind: 'rate_limited', retryAfterSeconds: typeof wait === 'number' ? wait : 1 };
    }
    if (code === 403) return { kind: 'blocked' };
    // A bad or revoked token answers 401/404 for every chat: that is our configuration, not a
    // permanent fact about this user, so it is retried (and fails at the attempt cap).
    if (code === 401 || code === 404) return { kind: 'transient', code: `http_${code}` };
    if (code >= 400 && code < 500) return { kind: 'permanent', code: `http_${code}` };
    return { kind: 'transient', code: `http_${code}` };
  }
  if (error instanceof HttpError) return { kind: 'ambiguous', code: 'network' };
  return { kind: 'ambiguous', code: 'unknown' };
}

/** `TelegramSender` over grammY's outbound `Api`. The Bot API root is a parameter (tests only). */
export function createGrammySender(options: { token: string; apiRoot?: string }): TelegramSender {
  const api = new Api(options.token, {
    timeoutSeconds: TIMEOUT_SECONDS,
    ...(options.apiRoot ? { apiRoot: options.apiRoot } : {}),
  });
  return {
    async sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome> {
      const id = Number(chatId);
      if (!Number.isSafeInteger(id)) return { kind: 'permanent', code: 'bad_chat_id' };
      try {
        // Plain text on purpose: no parse_mode, so nothing in the text is read as markup.
        const sent = await api.sendMessage(id, message.text, {
          reply_markup: {
            inline_keyboard: [[{ text: message.buttonText, web_app: { url: message.url } }]],
          },
        });
        return { kind: 'ok', messageId: sent.message_id };
      } catch (error) {
        return classifyTelegramError(error);
      }
    },
  };
}
