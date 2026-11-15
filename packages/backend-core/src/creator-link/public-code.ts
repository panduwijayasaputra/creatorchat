import { randomBytes } from 'node:crypto';
import { PUBLIC_CODE_LENGTH, PUBLIC_CODE_PATTERN } from '@creatorchat/contracts';

/** Lowercase base32 (RFC 4648 without padding): 32 symbols, so one masked byte is unbiased. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** A random 8-character public creator code. Callers retry on a unique-constraint conflict. */
export function generatePublicCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(PUBLIC_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) {
    code += ALPHABET[(bytes[i] ?? 0) & 31];
  }
  return code;
}

export function isPublicCode(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_CODE_PATTERN.test(value);
}
