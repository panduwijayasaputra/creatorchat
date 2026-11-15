import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSignedInitData, validateInitData } from './telegram-init-data.js';

const TOKEN = '123456:TEST-bot-token-not-real';
const NOW = new Date('2026-11-15T10:00:00Z');
const MAX_AGE = 86_400;
const user = { id: 123456789, first_name: 'Nadia', last_name: 'Putri', username: 'nadia' };

function signed(authDate: Date = NOW, extra?: Record<string, string>): string {
  return buildSignedInitData({
    botToken: TOKEN,
    user,
    authDate,
    ...(extra ? { extra } : {}),
  });
}

function reason(initData: string, token = TOKEN): string {
  const result = validateInitData(initData, token, NOW, MAX_AGE);
  return result.ok ? 'ok' : result.reason;
}

describe('validateInitData', () => {
  it('accepts correctly signed data and maps the user', () => {
    const result = validateInitData(signed(), TOKEN, NOW, MAX_AGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.telegramId).toBe(123456789n);
    expect(result.user.firstName).toBe('Nadia');
    expect(result.user.username).toBe('nadia');
    expect(result.authDate.getTime()).toBe(NOW.getTime());
  });

  it('matches an independently computed signature (Telegram algorithm)', () => {
    const authDate = String(Math.floor(NOW.getTime() / 1000));
    const userJson = JSON.stringify(user);
    const check = `auth_date=${authDate}\nquery_id=AAH123\nuser=${userJson}`;
    const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const hash = createHmac('sha256', secret).update(check).digest('hex');
    const raw = new URLSearchParams({
      query_id: 'AAH123',
      user: userJson,
      auth_date: authDate,
      hash,
    }).toString();
    expect(reason(raw)).toBe('ok');
  });

  it('keeps extra signed fields in the check string (start_param, signature)', () => {
    expect(reason(signed(NOW, { start_param: 'c_abc', signature: 'xyz' }))).toBe('ok');
  });

  it('rejects a tampered field', () => {
    const params = new URLSearchParams(signed());
    params.set('user', JSON.stringify({ ...user, id: 999 }));
    expect(reason(params.toString())).toBe('bad_signature');
  });

  it('rejects a tampered or wrongly shaped hash', () => {
    const params = new URLSearchParams(signed());
    params.set('hash', 'a'.repeat(64));
    expect(reason(params.toString())).toBe('bad_signature');
    params.set('hash', 'nothex');
    expect(reason(params.toString())).toBe('malformed');
    params.delete('hash');
    expect(reason(params.toString())).toBe('malformed');
  });

  it('rejects data signed with another bot token', () => {
    expect(reason(signed(), '999:other-token')).toBe('bad_signature');
  });

  it('applies the max age: fresh at the limit, expired just past it', () => {
    expect(reason(signed(new Date(NOW.getTime() - MAX_AGE * 1000)))).toBe('ok');
    expect(reason(signed(new Date(NOW.getTime() - (MAX_AGE + 1) * 1000)))).toBe('expired');
  });

  it('allows small clock skew but rejects an auth_date far in the future', () => {
    expect(reason(signed(new Date(NOW.getTime() + 30_000)))).toBe('ok');
    expect(reason(signed(new Date(NOW.getTime() + 3_600_000)))).toBe('malformed');
  });

  it('requires a valid user object', () => {
    const noUser = new URLSearchParams({ auth_date: '1763200800' });
    const sign = (p: URLSearchParams): string => {
      const check = [...p.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
      p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
      return p.toString();
    };
    const now = new Date('2025-11-15T10:00:00Z');
    expect(validateInitData(sign(new URLSearchParams(noUser)), TOKEN, now, 1e9)).toEqual({
      ok: false,
      reason: 'missing_user',
    });
    const badUser = new URLSearchParams({ auth_date: '1763200800', user: '{not json' });
    expect(validateInitData(sign(badUser), TOKEN, now, 1e9)).toEqual({
      ok: false,
      reason: 'missing_user',
    });
    const noId = new URLSearchParams({ auth_date: '1763200800', user: '{"first_name":"A"}' });
    expect(validateInitData(sign(noId), TOKEN, now, 1e9)).toEqual({
      ok: false,
      reason: 'missing_user',
    });
  });

  it('never throws on garbage and rejects oversized input', () => {
    for (const garbage of ['', 'x', '%', '%E0%A4%A', '&&&&', 'hash=', '\u0000', 'a'.repeat(5000)]) {
      expect(() => validateInitData(garbage, TOKEN, NOW, MAX_AGE)).not.toThrow();
      expect(reason(garbage)).not.toBe('ok');
    }
  });
});
