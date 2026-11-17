import { describe, expect, it } from 'vitest';
import { chatAccessState } from './chat-access.js';

const now = new Date('2026-11-17T05:00:00.000Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const DAY = 86_400_000;
const sub = (startsAt: Date, endsAt: Date, revokedAt: Date | null = null) => ({
  startsAt,
  endsAt,
  revokedAt,
});

describe('chatAccessState', () => {
  it('running subscription → ACTIVE with its end', () => {
    const s = sub(at(-DAY), at(DAY));
    expect(chatAccessState({ subscription: s, creatorBlocked: false }, now)).toEqual({
      state: 'ACTIVE',
      endsAt: s.endsAt,
    });
  });
  it('ends_at exactly now → EXPIRED', () => {
    const s = sub(at(-DAY), now);
    expect(chatAccessState({ subscription: s, creatorBlocked: false }, now)).toEqual({
      state: 'EXPIRED',
      endedAt: now,
    });
  });
  it('revoked → EXPIRED at the revocation time', () => {
    const revoked = at(-DAY / 2);
    expect(
      chatAccessState(
        { subscription: sub(at(-DAY), at(DAY), revoked), creatorBlocked: false },
        now,
      ),
    ).toEqual({ state: 'EXPIRED', endedAt: revoked });
  });
  it('blocked creator wins over a running subscription', () => {
    expect(
      chatAccessState({ subscription: sub(at(-DAY), at(DAY)), creatorBlocked: true }, now),
    ).toEqual({ state: 'CREATOR_BLOCKED' });
  });
  it('not started yet → EXPIRED; no subscription → EXPIRED without a date', () => {
    expect(
      chatAccessState({ subscription: sub(at(DAY), at(2 * DAY)), creatorBlocked: false }, now)
        .state,
    ).toBe('EXPIRED');
    expect(chatAccessState({ subscription: null, creatorBlocked: false }, now)).toEqual({
      state: 'EXPIRED',
      endedAt: null,
    });
  });
});
