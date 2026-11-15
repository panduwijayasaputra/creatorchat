import { describe, expect, it } from 'vitest';
import {
  creatorPath,
  CreatorLinkResponseSchema,
  PublicCodeSchema,
  StartPayloadSchema,
} from './creator-link.js';

describe('PublicCodeSchema', () => {
  it('accepts 8 lowercase base32 characters', () => {
    expect(PublicCodeSchema.safeParse('k4m9x2qa').success).toBe(false); // 9 is not base32
    expect(PublicCodeSchema.safeParse('k4m5x2qa').success).toBe(true);
    expect(PublicCodeSchema.safeParse('abcdefgh').success).toBe(true);
  });

  it.each(['', 'abcdefg', 'abcdefghi', 'ABCDEFGH', 'abcdef01', 'abcdef89', 'abcdéfgh', '../x2345'])(
    'rejects %j',
    (value) => {
      expect(PublicCodeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('StartPayloadSchema', () => {
  it.each(['c_k4m9x2qa', 'c_UNKNOWN', 'c_a', 'c_a-b_C'])('accepts %j', (value) => {
    expect(StartPayloadSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', 'c_', 'x_abc', 'c_a b', 'c_a;b', 'c_a/b', 'c_a?b', `c_${'a'.repeat(70)}`, ' c_abc'])(
    'rejects %j',
    (value) => {
      expect(StartPayloadSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('creatorPath', () => {
  it('builds the route and encodes unsafe input', () => {
    expect(creatorPath('k4m5x2qa')).toBe('/creators/k4m5x2qa');
    expect(creatorPath('../x?y')).toBe('/creators/..%2Fx%3Fy');
  });
});

describe('CreatorLinkResponseSchema', () => {
  const ok = { public_code: 'k4m5x2qa', display_name: 'Salsa', avatar_url: null };
  it('accepts exactly the three fields', () => {
    expect(CreatorLinkResponseSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects extra keys such as id, role or status', () => {
    for (const extra of [{ id: 'x' }, { role: 'CREATOR' }, { status: 'ACTIVE' }]) {
      expect(CreatorLinkResponseSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });
});
