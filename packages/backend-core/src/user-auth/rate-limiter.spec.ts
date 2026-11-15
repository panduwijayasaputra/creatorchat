import { describe, expect, it } from 'vitest';
import {
  FixedWindowLimiter,
  RateLimiterUnavailableError,
  type RateLimiterRedis,
} from './rate-limiter.js';

/** In-memory stand-in that records TTLs so "never without a TTL" can be asserted. */
function fakeRedis(): RateLimiterRedis & { ttls: Map<string, number> } {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    ttls,
    async get(key) {
      return values.has(key) ? String(values.get(key)) : null;
    },
    async incr(key) {
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    },
    async ttl(key) {
      return ttls.get(key) ?? -2;
    },
    async set(key, value, _mode, seconds, flag) {
      if (flag === 'NX' && values.has(key)) return null;
      values.set(key, Number(value));
      ttls.set(key, seconds);
      return 'OK';
    },
  };
}

describe('FixedWindowLimiter', () => {
  it('allows up to the limit, then blocks with a retry time', async () => {
    const limiter = new FixedWindowLimiter(fakeRedis(), 'p');
    for (let i = 0; i < 3; i++) expect((await limiter.hit('k', 3, 60)).allowed).toBe(true);
    const blocked = await limiter.hit('k', 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('keeps keys separate and always sets a TTL', async () => {
    const redis = fakeRedis();
    const limiter = new FixedWindowLimiter(redis, 'p');
    await limiter.hit('a', 1, 60);
    await limiter.record('b', 30);
    expect(redis.ttls.get('p:a')).toBe(60);
    expect(redis.ttls.get('p:b')).toBe(30);
    expect((await limiter.hit('c', 1, 60)).allowed).toBe(true);
  });

  it('peek does not count, and blocks once the counter reached the limit', async () => {
    const limiter = new FixedWindowLimiter(fakeRedis(), 'p');
    expect((await limiter.peek('bad', 2)).allowed).toBe(true);
    await limiter.record('bad', 60);
    expect((await limiter.peek('bad', 2)).allowed).toBe(true);
    await limiter.record('bad', 60);
    expect((await limiter.peek('bad', 2)).allowed).toBe(false);
  });

  it('wraps Redis errors so callers can fail closed', async () => {
    const broken: RateLimiterRedis = {
      get: () => Promise.reject(new Error('down')),
      incr: () => Promise.reject(new Error('down')),
      ttl: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
    };
    const limiter = new FixedWindowLimiter(broken, 'p');
    await expect(limiter.hit('k', 1, 60)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.peek('k', 1)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    await expect(limiter.record('k', 1)).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});
