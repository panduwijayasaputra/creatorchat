import { describe, expect, it } from 'vitest';
import { backoffMs, clampRetryAfterMs, MAX_ATTEMPTS } from './backoff.js';

describe('backoffMs', () => {
  it('follows 5 s, 30 s, 2 min, 10 min, 30 min, 1 h, 2 h and then stays at 2 h', () => {
    const minutes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => backoffMs(n) / 1000);
    expect(minutes).toEqual([5, 30, 120, 600, 1800, 3600, 7200, 7200, 7200, 7200]);
  });

  it('treats nonsense as the first step', () => {
    expect([backoffMs(0), backoffMs(-3), backoffMs(Number.NaN)]).toEqual([5000, 5000, 5000]);
  });

  it('has a finite attempt cap', () => {
    expect(MAX_ATTEMPTS).toBe(10);
  });
});

describe('clampRetryAfterMs', () => {
  it('keeps Telegram values inside 1 s to 1 h', () => {
    expect(clampRetryAfterMs(0)).toBe(1000);
    expect(clampRetryAfterMs(-5)).toBe(1000);
    expect(clampRetryAfterMs(Number.NaN)).toBe(1000);
    expect(clampRetryAfterMs(7)).toBe(7000);
    expect(clampRetryAfterMs(999_999)).toBe(3_600_000);
  });
});
