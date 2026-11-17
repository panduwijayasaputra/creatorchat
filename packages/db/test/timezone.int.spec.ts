import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma, loadRootEnv } from '../src/testing/index.js';

loadRootEnv();
const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

describe('database session', () => {
  it('runs in UTC, so DB defaults and app dates agree whatever the server zone is', async () => {
    const [row] = await prisma.$queryRaw<{ tz: string; drift: number }[]>`
      SELECT current_setting('TimeZone') AS tz,
             EXTRACT(EPOCH FROM (now() - ${new Date()}::timestamptz))::float8 AS drift`;
    expect(row?.tz).toBe('UTC');
    expect(Math.abs(row?.drift ?? 99_999)).toBeLessThan(5);
  });
});
