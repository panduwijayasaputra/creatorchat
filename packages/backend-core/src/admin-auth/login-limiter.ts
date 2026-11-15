import { ADMIN_LOGIN_LOCK_SECONDS, ADMIN_LOGIN_MAX_ATTEMPTS } from '@creatorchat/contracts';

/** The few Redis commands the limiter needs; `ioredis` satisfies this structurally. */
export interface LimiterRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', seconds: number, flag?: 'NX'): Promise<unknown>;
}

export const IP_FAILURE_LIMIT = 30;

/** Redis was unreachable. Login fails closed: no unlimited guessing while the limiter is blind. */
export class LoginLimiterUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Login limiter is unavailable', options);
    this.name = 'LoginLimiterUnavailableError';
  }
}

export interface LimiterVerdict {
  /** Seconds left of a username lock, 0 when not locked. */
  lockedSeconds: number;
  /** Seconds left of an IP block, 0 when not blocked. */
  ipBlockedSeconds: number;
}

export interface FailureResult {
  attempts: number;
  locked: boolean;
}

/**
 * Failed-login counters and the 15-minute lock, kept in Redis (decision 2026-11-15).
 * Keys use a fingerprint of the normalized username, so unknown usernames are counted exactly like
 * real ones and nothing in Redis holds a readable username.
 */
export class LoginLimiter {
  constructor(
    private readonly redis: LimiterRedis,
    private readonly prefix = 'admin:login',
    private readonly maxAttempts = ADMIN_LOGIN_MAX_ATTEMPTS,
    private readonly windowSeconds = ADMIN_LOGIN_LOCK_SECONDS,
    private readonly ipLimit = IP_FAILURE_LIMIT,
  ) {}

  private failKey(fp: string): string {
    return `${this.prefix}:fail:${fp}`;
  }
  private lockKey(fp: string): string {
    return `${this.prefix}:lock:${fp}`;
  }
  private ipKey(ip: string): string {
    return `${this.prefix}:ip:${ip}`;
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new LoginLimiterUnavailableError({ cause: error });
    }
  }

  async check(fingerprint: string, ip: string | undefined): Promise<LimiterVerdict> {
    return this.guard(async () => {
      const lockTtl = await this.redis.ttl(this.lockKey(fingerprint));
      let ipTtl = 0;
      if (ip) {
        const ipCount = Number((await this.redis.get(this.ipKey(ip))) ?? 0);
        if (ipCount >= this.ipLimit) ipTtl = Math.max(await this.redis.ttl(this.ipKey(ip)), 1);
      }
      return {
        lockedSeconds: lockTtl > 0 ? lockTtl : 0,
        ipBlockedSeconds: ipTtl,
      };
    });
  }

  /** Counts one failure. The window starts at the first failure; the 5th one sets the lock. */
  async recordFailure(fingerprint: string, ip: string | undefined): Promise<FailureResult> {
    return this.guard(async () => {
      const key = this.failKey(fingerprint);
      // SET NX EX first, then INCR: INCR keeps the TTL, so a key can never be left without one.
      await this.redis.set(key, '0', 'EX', this.windowSeconds, 'NX');
      const attempts = await this.redis.incr(key);
      let locked = false;
      if (attempts >= this.maxAttempts) {
        await this.redis.set(this.lockKey(fingerprint), '1', 'EX', this.windowSeconds);
        locked = true;
      }
      if (ip) {
        const ipKey = this.ipKey(ip);
        await this.redis.set(ipKey, '0', 'EX', this.windowSeconds, 'NX');
        await this.redis.incr(ipKey);
      }
      return { attempts: Math.min(attempts, this.maxAttempts), locked };
    });
  }

  /** A successful login clears the username counters (not the IP counter). */
  async reset(fingerprint: string): Promise<void> {
    await this.guard(() => this.redis.del(this.failKey(fingerprint), this.lockKey(fingerprint)));
  }
}
