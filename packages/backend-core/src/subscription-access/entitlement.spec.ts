import { describe, expect, it } from 'vitest';
import { isEntitled } from './entitlement.js';

const now = new Date('2026-11-16T00:00:00Z');
const at = (s: string) => new Date(s);

describe('isEntitled', () => {
  it('is true inside the window and false at the end instant, before the start, or when revoked', () => {
    const base = {
      startsAt: at('2026-11-01T00:00:00Z'),
      endsAt: at('2026-11-27T00:00:00Z'),
      revokedAt: null,
    };
    expect(isEntitled(base, now)).toBe(true);
    expect(isEntitled({ ...base, endsAt: now }, now)).toBe(false);
    expect(isEntitled({ ...base, startsAt: at('2026-11-17T00:00:00Z') }, now)).toBe(false);
    expect(isEntitled({ ...base, revokedAt: now }, now)).toBe(false);
  });
});
