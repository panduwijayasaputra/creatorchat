import { jwtVerify, SignJWT } from 'jose';

export const USER_TOKEN_ISSUER = 'creatorchat';
export const USER_TOKEN_AUDIENCE = 'user-api';
export const USER_TOKEN_TYPE = 'user';
export const MIN_USER_SECRET_LENGTH = 32;

export interface UserTokenClaims {
  userId: string;
  sessionId: string;
  sessionVersion: number;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** HS256 session token. The audience differs from the admin token, so neither works on the other API. */
export async function signUserToken(
  secret: string,
  claims: UserTokenClaims,
  now: Date,
  ttlSeconds: number,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sessionId, sv: claims.sessionVersion, typ: USER_TOKEN_TYPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(USER_TOKEN_ISSUER)
    .setAudience(USER_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(key(secret));
}

/** Claims, or null for any problem (signature, expiry, audience, type, shape). */
export async function verifyUserToken(
  secret: string,
  token: string,
  now: Date,
): Promise<UserTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: USER_TOKEN_ISSUER,
      audience: USER_TOKEN_AUDIENCE,
      currentDate: now,
    });
    if (payload.typ !== USER_TOKEN_TYPE) return null;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    if (typeof payload.sv !== 'number' || !Number.isInteger(payload.sv)) return null;
    return { userId: payload.sub, sessionId: payload.sid, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}
