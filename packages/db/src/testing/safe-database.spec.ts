import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase, UnsafeTestDatabaseError } from './safe-database.js';

const dev = 'postgresql://creatorchat:secret-pw@localhost:5432/creatorchat';

describe('assertSafeTestDatabase', () => {
  it('accepts a local database ending in _test', () => {
    const parsed = assertSafeTestDatabase(
      'postgresql://creatorchat:x@localhost:5432/creatorchat_test',
      dev,
    );
    expect(parsed.database).toBe('creatorchat_test');
  });

  it('refuses when unset', () => {
    expect(() => assertSafeTestDatabase(undefined, dev)).toThrow(UnsafeTestDatabaseError);
  });

  it('refuses the dev database even if it is named like a test one', () => {
    const same = 'postgresql://creatorchat:x@localhost:5432/creatorchat_test';
    expect(() => assertSafeTestDatabase(same, same)).toThrow(/same database/);
  });

  it('refuses names without the _test suffix', () => {
    expect(() => assertSafeTestDatabase(dev, undefined)).toThrow(/_test/);
  });

  it('refuses remote hosts', () => {
    expect(() =>
      assertSafeTestDatabase('postgresql://u:p@db.example.com:5432/creatorchat_test', dev),
    ).toThrow(/not local/);
  });

  it('never leaks credentials in the error message', () => {
    try {
      assertSafeTestDatabase(dev, undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-pw');
    }
  });

  it('refuses garbage', () => {
    expect(() => assertSafeTestDatabase('not a url', dev)).toThrow(UnsafeTestDatabaseError);
  });
});
