import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('matches the boards: one decimal with a comma below 10 MB, whole numbers above', () => {
    expect(formatBytes(2_516_582)).toBe('2,4 MB');
    expect(formatBytes(1_992_294)).toBe('1,9 MB');
    expect(formatBytes(18 * 1_048_576)).toBe('18 MB');
    expect(formatBytes(26 * 1_048_576)).toBe('26 MB');
  });
  it('handles small files', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(524_288)).toBe('512 KB');
    expect(formatBytes(2_097_152)).toBe('2,0 MB');
  });
});
