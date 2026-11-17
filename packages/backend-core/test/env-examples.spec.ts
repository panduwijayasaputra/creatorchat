import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

function keys(file: string): string[] {
  return read(file)
    .split(/\r?\n/)
    .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
}

describe('.env.example files', () => {
  const config = read('CONFIGURATION.md');

  it('document every server variable in CONFIGURATION.md (except seed-only keys)', () => {
    const seedOnly = new Set(['SEED_ADMIN_USERNAME', 'SEED_ADMIN_PASSWORD']);
    for (const key of keys('.env.example')) {
      if (seedOnly.has(key)) continue;
      expect(config, key).toContain(key);
    }
  });

  it('only contain VITE_* public names without secret-like words in the client files', () => {
    for (const file of ['apps/miniapp/.env.example', 'apps/admin/.env.example']) {
      for (const key of keys(file)) {
        expect(key.startsWith('VITE_'), `${file}:${key}`).toBe(true);
        expect(key).not.toMatch(/SECRET|TOKEN|KEY|PASSWORD/i);
      }
    }
  });

  it('uses placeholders for secrets in the root file', () => {
    const text = read('.env.example');
    expect(text).toMatch(/^TELEGRAM_BOT_TOKEN=<set-locally>$/m);
    expect(text).toMatch(/^R2_SECRET_ACCESS_KEY=<set-locally>$/m);
    expect(text).toMatch(/^SEED_ADMIN_PASSWORD=$/m);
  });
});

describe('.env.example as real input', () => {
  it('loads through loadEnv as-is and reports every integration as unconfigured', async () => {
    const { loadEnv, getIntegrationStatus } = await import('../src/index.js');
    const values: Record<string, string> = {};
    for (const line of read('.env.example').split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (m?.[1] !== undefined) values[m[1]] = m[2] ?? '';
    }
    const env = loadEnv(values);
    expect(getIntegrationStatus(env)).toEqual({
      telegram: 'unconfigured',
      telegramWebhook: 'unconfigured',
      r2: 'unconfigured',
      storage: 'unconfigured',
      ai: 'unconfigured',
      aiProvider: 'fake',
    });
    expect(env.API_PUBLIC_URL).toBeUndefined();
    expect(env.MINIAPP_URL).toBeUndefined();
    expect(env.R2_ACCOUNT_ENDPOINT).toBeUndefined();
  });
});
