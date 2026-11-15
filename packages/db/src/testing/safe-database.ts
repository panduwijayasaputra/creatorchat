const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing to use this database for tests: ${reason}`);
    this.name = 'UnsafeTestDatabaseError';
  }
}

export interface ParsedDatabaseUrl {
  host: string;
  port: string;
  database: string;
}

export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTestDatabaseError('the connection string is not a valid URL');
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/**
 * Integration tests must never run against dev (or any other) data. Throws unless the test URL
 * points at a local database whose name ends in `_test` and differs from the dev database.
 * Never includes credentials in the error message.
 */
export function assertSafeTestDatabase(
  testUrl: string | undefined,
  devUrl?: string,
): ParsedDatabaseUrl {
  if (!testUrl) {
    throw new UnsafeTestDatabaseError(
      'DATABASE_URL_TEST is not set. Copy .env.example to .env and create the test database.',
    );
  }
  const test = parseDatabaseUrl(testUrl);
  if (!LOCAL_HOSTS.has(test.host)) {
    throw new UnsafeTestDatabaseError(`host "${test.host}" is not local`);
  }
  if (!test.database.endsWith('_test')) {
    throw new UnsafeTestDatabaseError(`database name "${test.database}" must end with "_test"`);
  }
  if (devUrl) {
    let dev: ParsedDatabaseUrl | undefined;
    try {
      dev = parseDatabaseUrl(devUrl);
    } catch {
      dev = undefined;
    }
    if (dev && dev.host === test.host && dev.port === test.port && dev.database === test.database) {
      throw new UnsafeTestDatabaseError('it is the same database as DATABASE_URL');
    }
  }
  return test;
}
