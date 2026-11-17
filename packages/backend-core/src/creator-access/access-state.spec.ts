import { describe, expect, it } from 'vitest';
import { isEntitled } from '../subscription-access/entitlement.js';
import { accessStateOf } from './access-state.js';

const NOW = new Date('2026-11-16T08:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const sub = (startsMs: number, endsMs: number, revoked = false) => ({
  startsAt: at(startsMs),
  endsAt: at(endsMs),
  revokedAt: revoked ? at(-1000) : null,
});
const pending = { createdAt: at(-86_400_000), type: 'TRIAL' as const };

describe('accessStateOf', () => {
  it('GUEST without a subscription or a request', () => {
    expect(accessStateOf({ subscription: null, pending: null }, NOW)).toEqual({ state: 'GUEST' });
  });

  it('PENDING for a request without a subscription', () => {
    expect(accessStateOf({ subscription: null, pending }, NOW)).toEqual({
      state: 'PENDING',
      requestedAt: pending.createdAt,
      type: 'TRIAL',
    });
  });

  it('ACTIVE wins over a pending request', () => {
    const s = sub(-1000, 60_000);
    expect(accessStateOf({ subscription: s, pending }, NOW)).toEqual({
      state: 'ACTIVE',
      endsAt: s.endsAt,
    });
  });

  it('a pending request wins over an ended subscription', () => {
    expect(accessStateOf({ subscription: sub(-9e6, -1000), pending }, NOW).state).toBe('PENDING');
    expect(
      accessStateOf(
        { subscription: sub(-9e6, 9e6, true), pending: { ...pending, type: 'RENEWAL' } },
        NOW,
      ),
    ).toMatchObject({ state: 'PENDING', type: 'RENEWAL' });
  });

  it('EXPIRED for an ended subscription, at its end', () => {
    const s = sub(-9e6, -1000);
    expect(accessStateOf({ subscription: s, pending: null }, NOW)).toEqual({
      state: 'EXPIRED',
      endedAt: s.endsAt,
      revoked: false,
    });
  });

  it('a revoked subscription is EXPIRED at its revocation time', () => {
    const s = sub(-9e6, 9e6, true);
    expect(accessStateOf({ subscription: s, pending: null }, NOW)).toEqual({
      state: 'EXPIRED',
      endedAt: s.revokedAt,
      revoked: true,
    });
  });

  it('the boundary: ends_at = now is ended, one millisecond before is active', () => {
    expect(accessStateOf({ subscription: sub(-9e6, 0), pending: null }, NOW).state).toBe('EXPIRED');
    expect(accessStateOf({ subscription: sub(-9e6, 1), pending: null }, NOW).state).toBe('ACTIVE');
  });

  it('is ACTIVE exactly when isEntitled says so', () => {
    for (const starts of [-9e6, -1, 0, 1]) {
      for (const ends of [-1, 0, 1, 9e6]) {
        for (const revoked of [false, true]) {
          const s = sub(starts, ends, revoked);
          if (s.endsAt <= s.startsAt) continue;
          expect(accessStateOf({ subscription: s, pending: null }, NOW).state === 'ACTIVE').toBe(
            isEntitled(s, NOW),
          );
        }
      }
    }
  });
});
