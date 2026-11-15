import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signAccessToken } from '../admin-auth/tokens.js';
import { signUserToken, verifyUserToken } from './user-tokens.js';

const SECRET = 'user-secret-'.padEnd(48, 'u');
const NOW = new Date('2026-11-15T10:00:00Z');
const claims = { userId: 'u-1', sessionId: 's-1', sessionVersion: 3 };
const key = new TextEncoder().encode(SECRET);

describe('user tokens', () => {
  it('round-trips the claims', async () => {
    const token = await signUserToken(SECRET, claims, NOW, 3600);
    expect(await verifyUserToken(SECRET, token, NOW)).toEqual(claims);
  });

  it('rejects a wrong secret and an expired token', async () => {
    const token = await signUserToken(SECRET, claims, NOW, 3600);
    expect(await verifyUserToken('other-secret-'.padEnd(48, 'x'), token, NOW)).toBeNull();
    expect(await verifyUserToken(SECRET, token, new Date(NOW.getTime() + 3601_000))).toBeNull();
  });

  it('rejects an admin token even when signed with the same secret', async () => {
    const adminToken = await signAccessToken(SECRET, { adminId: 'a-1', sessionId: 's' }, NOW, 900);
    expect(await verifyUserToken(SECRET, adminToken, NOW)).toBeNull();
  });

  it('rejects alg none, other algorithms, a wrong type and a missing version', async () => {
    const base = (typ: string, sv?: number) =>
      new SignJWT({ sid: 's-1', typ, ...(sv === undefined ? {} : { sv }) })
        .setSubject('u-1')
        .setIssuer('creatorchat')
        .setAudience('user-api')
        .setIssuedAt(Math.floor(NOW.getTime() / 1000))
        .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 600);
    const hs512 = await base('user', 1).setProtectedHeader({ alg: 'HS512' }).sign(key);
    expect(await verifyUserToken(SECRET, hs512, NOW)).toBeNull();
    const wrongType = await base('admin', 1).setProtectedHeader({ alg: 'HS256' }).sign(key);
    expect(await verifyUserToken(SECRET, wrongType, NOW)).toBeNull();
    const noVersion = await base('user').setProtectedHeader({ alg: 'HS256' }).sign(key);
    expect(await verifyUserToken(SECRET, noVersion, NOW)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'u-1', sid: 's-1', sv: 1, typ: 'user' }),
    ).toString('base64url')}.`;
    expect(await verifyUserToken(SECRET, none, NOW)).toBeNull();
    expect(await verifyUserToken(SECRET, 'garbage', NOW)).toBeNull();
  });
});
