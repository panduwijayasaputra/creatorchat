import { describe, expect, it } from 'vitest';
import { createInitData, InitDataToolError } from '../scripts/initdata-tool.js';
import { validateInitData } from '../src/user-auth/telegram-init-data.js';

const TOKEN = '123456:local-dev-token-not-real';
const NOW = new Date('2026-11-15T10:00:00Z');
const env = { TELEGRAM_BOT_TOKEN: TOKEN };

describe('telegram:initdata tool', () => {
  it('prints initData that the validator accepts with the same token', () => {
    const { initData, devUrl } = createInitData(
      ['--id', '777', '--name', 'Maya', '--username', 'maya'],
      env,
      NOW,
    );
    const result = validateInitData(initData, TOKEN, NOW, 86_400);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.telegramId).toBe(777n);
      expect(result.user.firstName).toBe('Maya');
      expect(result.user.username).toBe('maya');
    }
    expect(devUrl.startsWith('http://localhost:5173/?tgdev=')).toBe(true);
    expect(decodeURIComponent(devUrl.split('tgdev=')[1] ?? '')).toBe(initData);
  });

  it('does not validate with another token, and honours --age-seconds', () => {
    const { initData } = createInitData(['--age-seconds', '90000'], env, NOW);
    expect(validateInitData(initData, '999:other', NOW, 86_400)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(validateInitData(initData, TOKEN, NOW, 86_400)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('never prints the bot token', () => {
    const { initData, devUrl } = createInitData([], env, NOW);
    expect(initData).not.toContain(TOKEN);
    expect(devUrl).not.toContain(TOKEN);
  });

  it('refuses production, a missing or placeholder token, and bad arguments', () => {
    expect(() => createInitData([], { ...env, NODE_ENV: 'production' }, NOW)).toThrow(
      InitDataToolError,
    );
    expect(() => createInitData([], {}, NOW)).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => createInitData([], { TELEGRAM_BOT_TOKEN: '<set-locally>' }, NOW)).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
    expect(() => createInitData(['--id', 'abc'], env, NOW)).toThrow(/--id/);
    expect(() => createInitData(['--age-seconds', '-5'], env, NOW)).toThrow(/--age-seconds/);
  });
});
