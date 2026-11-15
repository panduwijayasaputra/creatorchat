import { describe, expect, it } from 'vitest';
import { LoginLimiter, LoginLimiterUnavailableError, type LimiterRedis } from './login-limiter.js';

/** In-memory stand-in for the five Redis commands the limiter uses, with a controllable clock. */
class FakeRedis implements LimiterRedis {
  now = 0;
  private data = new Map<string, { value: string; expiresAt: number | null }>();
  down = false;

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }
  private check() {
    if (this.down) throw new Error('connection refused');
  }
  async get(key: string) {
    this.check();
    return this.live(key)?.value ?? null;
  }
  async incr(key: string) {
    this.check();
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }
  async ttl(key: string) {
    this.check();
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - this.now) / 1000);
  }
  async del(...keys: string[]) {
    this.check();
    keys.forEach((k) => this.data.delete(k));
  }
  async set(key: string, value: string, _mode: 'EX', seconds: number, flag?: 'NX') {
    this.check();
    if (flag === 'NX' && this.live(key)) return null;
    this.data.set(key, { value, expiresAt: this.now + seconds * 1000 });
    return 'OK';
  }
  keys() {
    return [...this.data.keys()];
  }
}

const FP = 'f'.repeat(64);

describe('LoginLimiter', () => {
  it('counts failures 1..4 and locks on the 5th', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await limiter.recordFailure(FP, '1.1.1.1'));
    expect(results.map((r) => r.attempts)).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => r.locked)).toEqual([false, false, false, false, true]);
    expect((await limiter.check(FP, '1.1.1.1')).lockedSeconds).toBe(900);
  });

  it('releases the lock after 15 minutes and starts a fresh count', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    for (let i = 0; i < 5; i += 1) await limiter.recordFailure(FP, undefined);
    redis.now += 899_000;
    expect((await limiter.check(FP, undefined)).lockedSeconds).toBe(1);
    redis.now += 2_000;
    expect((await limiter.check(FP, undefined)).lockedSeconds).toBe(0);
    expect((await limiter.recordFailure(FP, undefined)).attempts).toBe(1);
  });

  it('the failure window does not slide: it ends 15 minutes after the first failure', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    await limiter.recordFailure(FP, undefined);
    redis.now += 800_000;
    expect((await limiter.recordFailure(FP, undefined)).attempts).toBe(2);
    redis.now += 101_000;
    expect((await limiter.recordFailure(FP, undefined)).attempts).toBe(1);
  });

  it('reset clears the counter and the lock', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    for (let i = 0; i < 5; i += 1) await limiter.recordFailure(FP, undefined);
    await limiter.reset(FP);
    expect((await limiter.check(FP, undefined)).lockedSeconds).toBe(0);
    expect((await limiter.recordFailure(FP, undefined)).attempts).toBe(1);
  });

  it('blocks an IP after 30 failures across different usernames', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    for (let i = 0; i < 30; i += 1) await limiter.recordFailure(`user-${i}`, '9.9.9.9');
    const verdict = await limiter.check('brand-new-user', '9.9.9.9');
    expect(verdict.lockedSeconds).toBe(0);
    expect(verdict.ipBlockedSeconds).toBeGreaterThan(0);
    expect((await limiter.check('brand-new-user', '8.8.8.8')).ipBlockedSeconds).toBe(0);
  });

  it('never leaves a counter without a TTL', async () => {
    const redis = new FakeRedis();
    const limiter = new LoginLimiter(redis);
    await limiter.recordFailure(FP, '1.1.1.1');
    for (const key of redis.keys()) expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it('keeps no readable username in any key', async () => {
    const redis = new FakeRedis();
    await new LoginLimiter(redis).recordFailure('a'.repeat(64), undefined);
    expect(redis.keys().join(' ')).not.toMatch(/nadia/);
  });

  it('fails closed when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.down = true;
    const limiter = new LoginLimiter(redis);
    await expect(limiter.check(FP, undefined)).rejects.toBeInstanceOf(LoginLimiterUnavailableError);
    await expect(limiter.recordFailure(FP, undefined)).rejects.toBeInstanceOf(
      LoginLimiterUnavailableError,
    );
  });
});
