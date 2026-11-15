import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, 'admin-cli.ts');

function run(env: Record<string, string>, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: resolve(import.meta.dirname, '..'),
  });
}

const DEV_URL = 'postgresql://u:secret-pw@localhost:5432/creatorchat';

describe('admin CLI guards (no database needed)', () => {
  it('requires --username', () => {
    const r = run({ DATABASE_URL: DEV_URL }, []);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--username is required/);
  });

  it('refuses to run in production', () => {
    const r = run({ NODE_ENV: 'production', DATABASE_URL: DEV_URL }, ['--username', 'someone']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/production/);
    expect(r.stdout + r.stderr).not.toContain('secret-pw');
  });

  it('refuses a *_test database unless explicitly allowed', () => {
    const r = run({ NODE_ENV: 'development', DATABASE_URL: `${DEV_URL}_test` }, [
      '--username',
      'someone',
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/test database/);
    expect(r.stdout + r.stderr).not.toContain('secret-pw');
  });

  it('does not accept the password as a command-line argument', () => {
    const r = run({ NODE_ENV: 'development', DATABASE_URL: DEV_URL }, [
      '--username',
      'someone',
      '--password',
      'typed-on-the-command-line',
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--password/);
  });

  it('fails clearly when the named password variable is empty', () => {
    const r = run({ NODE_ENV: 'development', DATABASE_URL: DEV_URL, NOPE_PW: '' }, [
      '--username',
      'someone',
      '--password-env',
      'NOPE_PW',
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/NOPE_PW is empty or unset/);
  });
});
