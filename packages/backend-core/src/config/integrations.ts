import type { ServerEnv } from './env.js';

export type IntegrationState = 'configured' | 'unconfigured';

export interface IntegrationStatus {
  telegram: IntegrationState;
  r2: IntegrationState;
  ai: IntegrationState;
  /** Active AI provider name (e.g. `fake`); never a credential. */
  aiProvider: string;
}

/** Which external integrations have credentials. Never returns secret values. */
export function getIntegrationStatus(env: ServerEnv): IntegrationStatus {
  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);
  const r2 = Boolean(
    env.R2_ACCOUNT_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY,
  );
  const ai = env.AI_PROVIDER !== 'fake' && Boolean(env.AI_API_KEY);
  return {
    telegram: telegram ? 'configured' : 'unconfigured',
    r2: r2 ? 'configured' : 'unconfigured',
    ai: ai ? 'configured' : 'unconfigured',
    aiProvider: env.AI_PROVIDER,
  };
}
