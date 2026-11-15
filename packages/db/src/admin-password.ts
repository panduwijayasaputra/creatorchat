import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/** Argon2id parameters (OWASP minimum profile: 19 MiB, 2 iterations, 1 lane). Single source. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeAdminUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Admin username must be 3-32 characters: a-z, 0-9, ".", "_" or "-".');
  }
  return username;
}

export function generatePassword(): string {
  // 18 random bytes -> 24 URL-safe characters.
  return randomBytes(18).toString('base64url');
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a 500 that reveals the account.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs the same Argon2id work as a real check against a throwaway hash, so an unknown or disabled
 * account takes as long to reject as a wrong password. Always returns false.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}
