import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env.js';
import { getIntegrationStatus } from './integrations.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

const prod = {
  ...base,
  NODE_ENV: 'production',
  USER_SESSION_SECRET: 'a'.repeat(32),
  ADMIN_ACCESS_TOKEN_SECRET: 'b'.repeat(32),
  ADMIN_REFRESH_TOKEN_SECRET: 'c'.repeat(32),
  MASTER_ENCRYPTION_KEY: 'k'.repeat(44),
};

describe('loadEnv', () => {
  it('applies defaults in development with only DB and Redis set', () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.ALLOWED_ORIGINS).toEqual([]);
    expect(env.AI_PROVIDER).toBe('fake');
  });

  it('names the missing key without leaking any value', () => {
    const leaked = 'token-value-should-not-appear';
    try {
      loadEnv({ REDIS_URL: 'redis://localhost:6379', TELEGRAM_BOT_TOKEN: leaked });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const message = (error as EnvError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain(leaked);
    }
  });

  it('does not echo an invalid value in the error', () => {
    try {
      loadEnv({ ...base, DATABASE_URL: 'not a url but secret-xyz' });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvError).message).not.toContain('secret-xyz');
    }
  });

  it('parses the origin allowlist', () => {
    const env = loadEnv({
      ...base,
      ALLOWED_ORIGINS: 'http://localhost:5173, http://localhost:5174',
    });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('rejects production with missing secrets', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(EnvError);
  });

  it('rejects production with duplicated secrets', () => {
    expect(() => loadEnv({ ...prod, ADMIN_ACCESS_TOKEN_SECRET: prod.USER_SESSION_SECRET })).toThrow(
      /must differ/,
    );
  });

  it('rejects production with a short secret', () => {
    expect(() => loadEnv({ ...prod, USER_SESSION_SECRET: 'short' })).toThrow(/USER_SESSION_SECRET/);
  });

  it('accepts production with distinct strong secrets', () => {
    expect(loadEnv(prod).NODE_ENV).toBe('production');
  });
});

describe('getIntegrationStatus', () => {
  it('treats placeholders as unconfigured', () => {
    const env = loadEnv({
      ...base,
      TELEGRAM_BOT_TOKEN: '<set-locally>',
      TELEGRAM_BOT_USERNAME: '<bot_username>',
      R2_BUCKET: '<bucket>',
      AI_API_KEY: '<set-locally>',
    });
    expect(getIntegrationStatus(env)).toEqual({
      telegram: 'unconfigured',
      telegramWebhook: 'unconfigured',
      r2: 'unconfigured',
      ai: 'unconfigured',
      aiProvider: 'fake',
    });
  });

  it('reports configured without exposing any value', () => {
    const env = loadEnv({
      ...base,
      TELEGRAM_BOT_TOKEN: '123456:real-looking-token',
      TELEGRAM_BOT_USERNAME: 'SomeBot',
    });
    const status = getIntegrationStatus(env);
    expect(status.telegram).toBe('configured');
    expect(JSON.stringify(status)).not.toContain('real-looking-token');
  });

  it('reports the webhook configured only with token, username, a long secret and the Mini App URL', () => {
    const full = {
      ...base,
      TELEGRAM_BOT_TOKEN: '123456:real-looking-token',
      TELEGRAM_BOT_USERNAME: 'SomeBot',
      TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(40),
      MINIAPP_URL: 'https://app.example.test',
    };
    expect(getIntegrationStatus(loadEnv(full)).telegramWebhook).toBe('configured');
    expect(
      getIntegrationStatus(loadEnv({ ...full, TELEGRAM_WEBHOOK_SECRET: 'short' })).telegramWebhook,
    ).toBe('unconfigured');
    expect(
      getIntegrationStatus(loadEnv({ ...full, TELEGRAM_WEBHOOK_SECRET: undefined }))
        .telegramWebhook,
    ).toBe('unconfigured');
    expect(getIntegrationStatus(loadEnv({ ...full, MINIAPP_URL: undefined })).telegramWebhook).toBe(
      'unconfigured',
    );
    const status = getIntegrationStatus(loadEnv(full));
    expect(JSON.stringify(status)).not.toContain('wwww');
  });

  it('keeps AI unconfigured while the provider is fake even with a key', () => {
    const env = loadEnv({ ...base, AI_PROVIDER: 'fake', AI_API_KEY: 'k' });
    expect(getIntegrationStatus(env).ai).toBe('unconfigured');
  });
});
