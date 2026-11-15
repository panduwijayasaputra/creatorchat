import { describe, expect, it } from 'vitest';
import { parseTelegramId, telegramIdToString } from './ids.js';

describe('Telegram ID helpers', () => {
  it('round-trips values beyond Number.MAX_SAFE_INTEGER', () => {
    const big = 9_007_199_254_740_993n;
    expect(parseTelegramId(telegramIdToString(big))).toBe(big);
  });

  it.each(['', '-1', 'abc', '0', '01', '1.5', '123456789012345678901'])('rejects %j', (value) => {
    expect(() => parseTelegramId(value)).toThrow();
  });
});
