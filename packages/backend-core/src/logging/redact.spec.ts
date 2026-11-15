import { describe, expect, it } from 'vitest';
import { REDACTED, redactLogFields } from './redact.js';

describe('redactLogFields', () => {
  it('masks sensitive keys at any depth, case-insensitively', () => {
    const out = redactLogFields({
      Authorization: 'Bearer abc',
      nested: { initData: 'query_id=1', list: [{ refreshToken: 'tok-1', ok: 1 }] },
      password: 'hunter2',
      keep: 'visible',
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/Bearer abc|query_id|hunter2|tok-1/);
    expect(out.Authorization).toBe(REDACTED);
    expect(out.keep).toBe('visible');
  });
});
