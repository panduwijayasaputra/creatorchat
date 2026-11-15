import type { ServerEnv } from './env.js';

export type IntegrationState = 'configured' | 'unconfigured';

export interface IntegrationStatus {
  telegram: IntegrationState;
  /** Bot webhook: token, username, webhook secret (>= 32 chars) and Mini App URL are all present. */
  telegramWebhook: IntegrationState;
  r2: IntegrationState;
  ai: IntegrationState;
  /** Active AI provider name (e.g. `fake`); never a credential. */
  aiProvider: string;
}

const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** The webhook needs the bot (token + username), a long enough secret and the Mini App URL. */
export function isTelegramWebhookConfigured(
  env: Pick<
    ServerEnv,
    'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_BOT_USERNAME' | 'TELEGRAM_WEBHOOK_SECRET' | 'MINIAPP_URL'
  >,
): boolean {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_BOT_USERNAME &&
    env.MINIAPP_URL &&
    secret &&
    secret.length >= MIN_WEBHOOK_SECRET_LENGTH &&
    secret !== env.TELEGRAM_BOT_TOKEN,
  );
}

/** Which external integrations have credentials. Never returns secret values. */
export function getIntegrationStatus(env: ServerEnv): IntegrationStatus {
  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);
  const telegramWebhook = isTelegramWebhookConfigured(env);
  const r2 = Boolean(
    env.R2_ACCOUNT_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY,
  );
  const ai = env.AI_PROVIDER !== 'fake' && Boolean(env.AI_API_KEY);
  return {
    telegram: telegram ? 'configured' : 'unconfigured',
    telegramWebhook: telegramWebhook ? 'configured' : 'unconfigured',
    r2: r2 ? 'configured' : 'unconfigured',
    ai: ai ? 'configured' : 'unconfigured',
    aiProvider: env.AI_PROVIDER,
  };
}
