import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashRefreshToken,
  signAccessToken,
  usernameFingerprint,
  verifyAccessToken,
} from './tokens.js';

const SECRET = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const NOW = new Date('2026-11-15T10:00:00Z');
const claims = { adminId: '3f2b8c1e-5d4a-4b7e-9c1a-2d3e4f5a6b7c', sessionId: 'session-1' };

const enc = (s: string) => new TextEncoder().encode(s);

describe('access token', () => {
  it('round-trips the admin and session ids', async () => {
    const token = await signAccessToken(SECRET, claims, NOW, 900);
    expect(await verifyAccessToken(SECRET, token, NOW)).toEqual(claims);
  });

  it('expires after the TTL', async () => {
    const token = await signAccessToken(SECRET, claims, NOW, 900);
    expect(
      await verifyAccessToken(SECRET, token, new Date(NOW.getTime() + 899_000)),
    ).not.toBeNull();
    expect(await verifyAccessToken(SECRET, token, new Date(NOW.getTime() + 901_000))).toBeNull();
  });

  it('rejects a token signed with another secret (e.g. a user-session secret)', async () => {
    const token = await signAccessToken(OTHER, claims, NOW, 900);
    expect(await verifyAccessToken(SECRET, token, NOW)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken(SECRET, claims, NOW, 900);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        sub: 'someone-else',
        sid: 'x',
        typ: 'admin',
        iss: 'creatorchat',
        aud: 'admin-api',
      }),
    ).toString('base64url');
    expect(await verifyAccessToken(SECRET, `${h}.${forged}.${s}`, NOW)).toBeNull();
  });

  it('rejects alg none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: claims.adminId,
        sid: claims.sessionId,
        typ: 'admin',
        iss: 'creatorchat',
        aud: 'admin-api',
        exp: Math.floor(NOW.getTime() / 1000) + 600,
      }),
    ).toString('base64url');
    expect(await verifyAccessToken(SECRET, `${header}.${body}.`, NOW)).toBeNull();
  });

  it('rejects HS384 even with the right secret (algorithm is pinned)', async () => {
    const token = await new SignJWT({ sid: 's', typ: 'admin' })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject(claims.adminId)
      .setIssuer('creatorchat')
      .setAudience('admin-api')
      .setExpirationTime('10m')
      .sign(enc(SECRET));
    expect(await verifyAccessToken(SECRET, token, new Date())).toBeNull();
  });

  it.each([
    ['wrong type', { typ: 'user' }, 'creatorchat', 'admin-api'],
    ['wrong issuer', { typ: 'admin' }, 'someone', 'admin-api'],
    ['wrong audience', { typ: 'admin' }, 'creatorchat', 'user-api'],
  ])('rejects a token with %s', async (_name, extra, iss, aud) => {
    const token = await new SignJWT({ sid: 's', ...extra })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.adminId)
      .setIssuer(iss)
      .setAudience(aud)
      .setExpirationTime('10m')
      .sign(enc(SECRET));
    expect(await verifyAccessToken(SECRET, token, new Date())).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken(SECRET, 'not-a-jwt', NOW)).toBeNull();
    expect(await verifyAccessToken(SECRET, '', NOW)).toBeNull();
  });
});

describe('refresh token helpers', () => {
  it('generates distinct 43-character tokens', () => {
    const a = generateOpaqueToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(generateOpaqueToken());
  });

  it('hashes with a secret: same input and secret match, different secret does not', () => {
    const t = generateOpaqueToken();
    expect(hashRefreshToken(SECRET, t)).toBe(hashRefreshToken(SECRET, t));
    expect(hashRefreshToken(SECRET, t)).not.toBe(hashRefreshToken(OTHER, t));
    expect(hashRefreshToken(SECRET, t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(SECRET, t)).not.toContain(t);
  });

  it('fingerprints usernames without exposing them', () => {
    const f = usernameFingerprint('nadia.admin');
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).not.toContain('nadia');
  });
});
