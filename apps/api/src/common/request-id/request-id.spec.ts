import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

describe('resolveRequestId', () => {
  it('keeps a safe caller id', () => {
    expect(resolveRequestId('abc-12345_X.y')).toBe('abc-12345_X.y');
  });

  it('uses the first value of a repeated header', () => {
    expect(resolveRequestId(['first-id-0001', 'second-id-002'])).toBe('first-id-0001');
  });

  it('generates a UUID when missing or unsafe', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('bad id with spaces')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
