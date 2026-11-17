import type { BotMessage } from './creator-result-message.js';

/**
 * What happened when a message was handed to Telegram. The adapter classifies every error into one
 * of these; no error text or cause is carried, because Telegram errors can echo a URL with the bot
 * token. `code` is a short machine code such as `http_500`.
 */
export type SendOutcome =
  | { kind: 'ok'; messageId: number }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  /** 403: the user blocked the bot or deactivated the account. */
  | { kind: 'blocked' }
  /** Other 4xx (chat not found, bad request): retrying cannot help. */
  | { kind: 'permanent'; code: string }
  /** 5xx: Telegram failed; nothing was delivered. */
  | { kind: 'transient'; code: string }
  /** Timeout or network error: the message may or may not have been delivered. */
  | { kind: 'ambiguous'; code: string };

export interface TelegramSender {
  sendMessage(chatId: bigint, message: BotMessage): Promise<SendOutcome>;
}
