import { buildStartReply } from '@creatorchat/backend-core';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

export interface TelegramBotConfig {
  token: string;
  username: string;
  miniAppUrl: string;
  /** Test seam: a fake Bot API root. Production uses Telegram's own. */
  apiRoot?: string;
  /** Called with the error class name only; never the message (it may echo Telegram data). */
  onError?: (errorName: string) => void;
}

/**
 * `getMe` is never called: the bot's identity is derived from config, so the first webhook request
 * does not wait on an outbound call. Telegram's token has the shape `<bot id>:<secret>`.
 */
function botInfoFrom(token: string, username: string): UserFromGetMe {
  const id = Number.parseInt(token.split(':')[0] ?? '', 10);
  return {
    id: Number.isSafeInteger(id) ? id : 0,
    is_bot: true,
    first_name: username,
    username,
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  } as UserFromGetMe;
}

/**
 * The creator-link bot (US-005). Only `/start [payload]` in a private chat is answered; every other
 * update is acknowledged without a reply. Replies travel as the webhook's HTTP response (grammY's
 * webhook reply), so no outbound Bot API call is made while Telegram waits.
 */
export function createTelegramBot(config: TelegramBotConfig): Bot {
  const bot = new Bot(config.token, {
    botInfo: botInfoFrom(config.token, config.username),
    client: {
      // Reply through the webhook's HTTP response: no outbound Bot API call while Telegram waits.
      canUseWebhookReply: (method) => method === 'sendMessage',
      ...(config.apiRoot ? { apiRoot: config.apiRoot } : {}),
    },
  });

  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const reply = buildStartReply({ payload: ctx.match, miniAppUrl: config.miniAppUrl });
    if (!reply) return;
    await ctx.reply(reply.text, {
      reply_markup: {
        inline_keyboard: [[{ text: reply.buttonText, web_app: { url: reply.url } }]],
      },
    });
  });

  bot.catch((error) => {
    config.onError?.(error.error instanceof Error ? error.error.name : 'UnknownError');
  });

  return bot;
}
