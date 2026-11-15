import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, 'seed.ts');

function runSeedCli(env: Record<string, string>, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: resolve(import.meta.dirname, '..'),
  });
}

describe('seed CLI guards (no database needed)', () => {
  it('refuses to run when NODE_ENV is production', () => {
    const r = runSeedCli({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:secret-pw@localhost:5432/creatorchat',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/production/);
    expect(r.stdout + r.stderr).not.toContain('secret-pw');
  });

  it('refuses to seed a *_test database unless explicitly allowed', () => {
    const r = runSeedCli({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://u:secret-pw@localhost:5432/creatorchat_test',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/test database/);
    expect(r.stdout + r.stderr).not.toContain('secret-pw');
  });

  it('refuses when DATABASE_URL is missing', () => {
    const r = runSeedCli({ NODE_ENV: 'development', DATABASE_URL: '' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/DATABASE_URL/);
  });
});
