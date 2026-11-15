import { createHash, createHmac, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ADMIN_TOKEN_ISSUER = 'creatorchat';
export const ADMIN_TOKEN_AUDIENCE = 'admin-api';
export const ADMIN_TOKEN_TYPE = 'admin';
export const MIN_SECRET_BYTES = 32;

export interface AccessTokenClaims {
  adminId: string;
  sessionId: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** HS256 access token. The algorithm is pinned on verify, so `alg: none` or RS/ES tokens fail. */
export async function signAccessToken(
  secret: string,
  claims: AccessTokenClaims,
  now: Date,
  ttlSeconds: number,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sessionId, typ: ADMIN_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.adminId)
    .setIssuer(ADMIN_TOKEN_ISSUER)
    .setAudience(ADMIN_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(key(secret));
}

/** Returns the claims, or null for any problem (bad signature, expired, wrong type/audience...). */
export async function verifyAccessToken(
  secret: string,
  token: string,
  now: Date,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ADMIN_TOKEN_ISSUER,
      audience: ADMIN_TOKEN_AUDIENCE,
      currentDate: now,
    });
    if (payload.typ !== ADMIN_TOKEN_TYPE) return null;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { adminId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url. Used for refresh tokens and CSRF tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed hash stored in `sessions`; the refresh token itself is never persisted. */
export function hashRefreshToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Stable, non-reversible fingerprint of a username, used for rate-limit keys and audit entries. */
export function usernameFingerprint(normalizedUsername: string): string {
  return createHash('sha256').update(normalizedUsername).digest('hex');
}
