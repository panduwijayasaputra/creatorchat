import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTime } from './date-time';

const instant = '2026-11-16T00:00:00Z';

describe('formatTime', () => {
  it('shows the same UTC instant in each zone', () => {
    expect(formatTime(instant, 'Asia/Jakarta')).toBe('07.00');
    expect(formatTime(instant, 'Asia/Makassar')).toBe('08.00');
    expect(formatTime(instant, 'Asia/Jayapura')).toBe('09.00');
    expect(formatTime(instant, 'Asia/Singapore')).toBe('08.00');
  });

  it('follows daylight saving for Sydney', () => {
    expect(formatTime('2026-11-16T00:00:00Z', 'Australia/Sydney')).toBe('11.00');
    expect(formatTime('2026-07-01T00:00:00Z', 'Australia/Sydney')).toBe('10.00');
  });
});

describe('formatDateTime', () => {
  it('rolls the date over when the zone is past midnight', () => {
    const late = '2026-11-16T20:00:00Z';
    expect(formatDateTime(late, 'Asia/Jakarta', { day: 'numeric', month: 'numeric' })).toBe(
      '17/11',
    );
    expect(formatDateTime(late, 'UTC', { day: 'numeric', month: 'numeric' })).toBe('16/11');
  });

  it('accepts a Date or a timestamp and does not change the instant', () => {
    const date = new Date(instant);
    expect(formatTime(date, 'Asia/Jakarta')).toBe(formatTime(date.getTime(), 'Asia/Jakarta'));
    expect(date.toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });

  it('falls back to Asia/Jakarta for an unknown zone and never throws on bad input', () => {
    expect(formatTime(instant, 'Not/AZone')).toBe('07.00');
    expect(formatTime(instant, '')).toBe('07.00');
    expect(formatDateTime('not a date', 'Asia/Jakarta')).toBe('-');
  });
});
