import { parseArgs } from 'node:util';
import { isUnset } from '../src/config/env.js';
import { BOT_COPY } from '../src/creator-link/bot-copy.js';

export const USAGE = `Usage: pnpm telegram:webhook <info|set|delete> [--yes] [--drop-pending]

Connects (or disconnects) the Telegram bot for this environment. Reads TELEGRAM_BOT_TOKEN,
TELEGRAM_WEBHOOK_SECRET, API_PUBLIC_URL and MINIAPP_URL from .env.

  info            show what Telegram has registered (read-only)
  set             register the webhook (${'`'}<API_PUBLIC_URL>/v1/telegram/webhook${'`'}, message updates only)
                  and set the bot's menu button to open the Mini App
  delete          remove the webhook
  --yes           actually do it. Without it, set/delete only print what would change (dry run)
  --drop-pending  also drop updates Telegram has queued

This changes a REAL bot, so it only runs when you ask. API_PUBLIC_URL and MINIAPP_URL must be https
(use your own tunnel or domain). The bot token and the secret are never printed.`;

export class WebhookToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookToolError';
  }
}

export const WEBHOOK_API_PATH = '/v1/telegram/webhook';
const MIN_SECRET_LENGTH = 32;
const DEFAULT_API_ROOT = 'https://api.telegram.org';

export interface WebhookToolDeps {
  fetch?: typeof fetch;
  /** Test seam only: the runner never takes this from the environment, so the token cannot be redirected. */
  apiRoot?: string;
  log?: (line: string) => void;
}

function requireHttps(name: string, value: string | undefined): string {
  if (value === undefined || isUnset(value)) {
    throw new WebhookToolError(`${name} is not set in .env.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookToolError(`${name} is not a valid URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new WebhookToolError(
      `${name} must be an https URL (Telegram only calls https webhooks).`,
    );
  }
  return url.origin;
}

interface TelegramReply {
  ok?: boolean;
  description?: string;
  result?: unknown;
}

async function callBotApi(
  deps: Required<Pick<WebhookToolDeps, 'fetch' | 'apiRoot'>>,
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiRoot}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // The underlying error text can include the request URL (and so the token): never print it.
    throw new WebhookToolError(`Could not reach the Telegram Bot API for ${method}.`);
  }
  let body: TelegramReply = {};
  try {
    body = (await response.json()) as TelegramReply;
  } catch {
    // Non-JSON answer: reported below by status.
  }
  if (!response.ok || body.ok !== true) {
    throw new WebhookToolError(
      `Telegram rejected ${method} (HTTP ${response.status}): ${body.description ?? 'no description'}`,
    );
  }
  return body.result;
}

export async function runWebhookCommand(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: WebhookToolDeps = {},
): Promise<void> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', default: false },
      'drop-pending': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const command = positionals[0];
  if (command !== 'info' && command !== 'set' && command !== 'delete') {
    throw new WebhookToolError(USAGE);
  }
  if (positionals.length > 1) throw new WebhookToolError(USAGE);

  if (env.NODE_ENV === 'production') {
    throw new WebhookToolError('Refusing to run: NODE_ENV is production.');
  }
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token === undefined || isUnset(token)) {
    throw new WebhookToolError('TELEGRAM_BOT_TOKEN is not set in .env.');
  }
  const api = {
    fetch: deps.fetch ?? fetch,
    apiRoot: deps.apiRoot ?? DEFAULT_API_ROOT,
  };

  if (command === 'info') {
    const info = (await callBotApi(api, token, 'getWebhookInfo', {})) as Record<string, unknown>;
    let target = '(none)';
    if (typeof info.url === 'string' && info.url !== '') {
      try {
        const parsed = new URL(info.url);
        target = parsed.origin + parsed.pathname;
      } catch {
        target = '(unreadable)';
      }
    }
    log(`Webhook URL: ${target}`);
    log(`Pending updates: ${String(info.pending_update_count ?? 0)}`);
    if (typeof info.last_error_message === 'string') {
      log(`Last error: ${info.last_error_message}`);
    }
    return;
  }

  const dry = !values.yes;

  if (command === 'delete') {
    log(
      `Will remove the bot's webhook${values['drop-pending'] ? ' and drop pending updates' : ''}.`,
    );
    if (dry) {
      log('Dry run: nothing changed. Add --yes to do it.');
      return;
    }
    await callBotApi(api, token, 'deleteWebhook', {
      drop_pending_updates: values['drop-pending'],
    });
    log('Webhook removed.');
    return;
  }

  // set
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (secret === undefined || isUnset(secret) || secret.length < MIN_SECRET_LENGTH) {
    throw new WebhookToolError(
      `TELEGRAM_WEBHOOK_SECRET must be set in .env (at least ${MIN_SECRET_LENGTH} characters).`,
    );
  }
  if (secret === token) {
    throw new WebhookToolError('TELEGRAM_WEBHOOK_SECRET must differ from the bot token.');
  }
  const apiOrigin = requireHttps('API_PUBLIC_URL', env.API_PUBLIC_URL);
  const miniAppOrigin = requireHttps('MINIAPP_URL', env.MINIAPP_URL);
  const webhookUrl = `${apiOrigin}${WEBHOOK_API_PATH}`;

  log('Will change the bot (a real Telegram bot):');
  log(
    `  setWebhook       -> ${webhookUrl} (secret header from TELEGRAM_WEBHOOK_SECRET; message updates only)`,
  );
  log(`  setChatMenuButton -> "${BOT_COPY.menuButton}" opens ${miniAppOrigin}/`);
  if (values['drop-pending']) log('  and drops pending updates');
  if (dry) {
    log('Dry run: nothing changed. Add --yes to do it.');
    return;
  }
  await callBotApi(api, token, 'setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: values['drop-pending'],
  });
  await callBotApi(api, token, 'setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: BOT_COPY.menuButton,
      web_app: { url: `${miniAppOrigin}/` },
    },
  });
  log('Webhook and menu button set.');
}
