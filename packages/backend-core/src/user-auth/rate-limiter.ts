/** The few Redis commands needed; `ioredis` satisfies this structurally. */
export interface RateLimiterRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  set(key: string, value: string, mode: 'EX', seconds: number, flag?: 'NX'): Promise<unknown>;
}

/** Redis was unreachable. Callers fail closed (503) instead of allowing unlimited attempts. */
export class RateLimiterUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Rate limiter is unavailable', options);
    this.name = 'RateLimiterUnavailableError';
  }
}

export interface RateVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fixed-window counters. `SET NX EX` precedes `INCR`, so a counter can never be left without a TTL. */
export class FixedWindowLimiter {
  constructor(
    private readonly redis: RateLimiterRedis,
    private readonly prefix: string,
  ) {}

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new RateLimiterUnavailableError({ cause: error });
    }
  }

  /** Counts one event; `allowed` is false once the window holds more than `limit` events. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateVerdict> {
    return this.guard(async () => {
      const full = `${this.prefix}:${key}`;
      await this.redis.set(full, '0', 'EX', windowSeconds, 'NX');
      const count = await this.redis.incr(full);
      if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(await this.redis.ttl(full), 1) };
    });
  }

  /** Looks at a counter without counting: blocked once it has reached `limit`. */
  async peek(key: string, limit: number): Promise<RateVerdict> {
    return this.guard(async () => {
      const full = `${this.prefix}:${key}`;
      const count = Number((await this.redis.get(full)) ?? 0);
      if (count < limit) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(await this.redis.ttl(full), 1) };
    });
  }

  /** Counts an event without judging it (the invalid-attempt counter). */
  async record(key: string, windowSeconds: number): Promise<void> {
    await this.guard(async () => {
      const full = `${this.prefix}:${key}`;
      await this.redis.set(full, '0', 'EX', windowSeconds, 'NX');
      await this.redis.incr(full);
    });
  }
}
