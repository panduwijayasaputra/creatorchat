import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(48)).toBe('0:48');
    expect(formatDuration(72)).toBe('1:12');
    expect(formatDuration(3600)).toBe('60:00');
  });
  it('treats bad input as zero and drops fractions', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(59.9)).toBe('0:59');
  });
});
