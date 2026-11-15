import { PUBLIC_CODE_PATTERN } from '@creatorchat/contracts';
import { describe, expect, it } from 'vitest';
import { generatePublicCode, isPublicCode } from './public-code.js';

describe('generatePublicCode', () => {
  it('always matches the public code pattern', () => {
    for (let i = 0; i < 1000; i++) expect(generatePublicCode()).toMatch(PUBLIC_CODE_PATTERN);
  });

  it('produces no duplicates in 10 000 codes and uses the whole alphabet', () => {
    const codes = new Set<string>();
    const symbols = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generatePublicCode();
      codes.add(code);
      for (const ch of code) symbols.add(ch);
    }
    expect(codes.size).toBe(10_000);
    expect(symbols.size).toBe(32);
  });

  it('is deterministic for an injected random source and maps bytes without bias', () => {
    expect(generatePublicCode(() => new Uint8Array(8))).toBe('aaaaaaaa');
    // byte & 31: 31 -> '7', 32 -> 'a', 255 -> '7', 26 -> '2', 64 -> 'a', 1 -> 'b'
    expect(generatePublicCode(() => new Uint8Array([31, 32, 255, 26, 64, 1, 0, 63]))).toBe(
      '7a72aba7',
    );
  });
});

describe('isPublicCode', () => {
  it('accepts valid and rejects invalid values', () => {
    expect(isPublicCode('k4m5x2qa')).toBe(true);
    expect(isPublicCode('K4M5X2QA')).toBe(false);
    expect(isPublicCode(42)).toBe(false);
    expect(isPublicCode(undefined)).toBe(false);
  });
});
