import { describe, expect, it } from 'vitest';
import {
  TIMEZONE_OPTIONS,
  UpdateTimezoneRequestSchema,
  timezoneDetail,
  timezoneSummary,
  utcOffsetLabel,
} from './timezone.js';

describe('UpdateTimezoneRequestSchema', () => {
  it('accepts exactly the five designed zones', () => {
    expect(TIMEZONE_OPTIONS).toHaveLength(5);
    for (const { id } of TIMEZONE_OPTIONS) {
      expect(UpdateTimezoneRequestSchema.parse({ timezone: id })).toEqual({ timezone: id });
    }
  });

  it('rejects everything else', () => {
    for (const bad of [
      'UTC',
      'Asia/Tokyo',
      '',
      'asia/jakarta',
      'Asia/Jakarta ',
      123,
      null,
      undefined,
      ['Asia/Jakarta'],
    ]) {
      expect(UpdateTimezoneRequestSchema.safeParse({ timezone: bad }).success).toBe(false);
    }
    expect(UpdateTimezoneRequestSchema.safeParse({}).success).toBe(false);
  });

  it('strips unknown keys', () => {
    const parsed = UpdateTimezoneRequestSchema.parse({
      timezone: 'Asia/Makassar',
      id: 'x',
      role: 'ADMIN',
      display_name: 'hacker',
    });
    expect(parsed).toEqual({ timezone: 'Asia/Makassar' });
  });
});

describe('utcOffsetLabel', () => {
  it('gives the fixed Indonesian and Singapore offsets all year', () => {
    for (const month of [1, 7]) {
      const at = new Date(Date.UTC(2026, month, 15));
      expect(utcOffsetLabel('Asia/Jakarta', at)).toBe('UTC+7');
      expect(utcOffsetLabel('Asia/Makassar', at)).toBe('UTC+8');
      expect(utcOffsetLabel('Asia/Jayapura', at)).toBe('UTC+9');
      expect(utcOffsetLabel('Asia/Singapore', at)).toBe('UTC+8');
    }
  });

  it('follows daylight saving for Sydney', () => {
    expect(utcOffsetLabel('Australia/Sydney', new Date('2026-11-16T00:00:00Z'))).toBe('UTC+11');
    expect(utcOffsetLabel('Australia/Sydney', new Date('2026-07-01T00:00:00Z'))).toBe('UTC+10');
  });

  it('formats half-hour zones and UTC, and returns an empty string for unknown ids', () => {
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-01-01T00:00:00Z'))).toBe('UTC+5:30');
    expect(utcOffsetLabel('UTC', new Date('2026-01-01T00:00:00Z'))).toBe('UTC+0');
    expect(utcOffsetLabel('Not/AZone', new Date())).toBe('');
    expect(utcOffsetLabel('', new Date())).toBe('');
  });
});

describe('timezoneDetail and timezoneSummary', () => {
  const at = new Date('2026-11-16T00:00:00Z');

  it('builds the option detail line and the settings row text', () => {
    expect(timezoneDetail('Asia/Jakarta', at)).toBe('Asia/Jakarta · UTC+7');
    expect(timezoneDetail('Australia/Sydney', at)).toBe('Australia/Sydney · UTC+11');
    expect(timezoneSummary('Asia/Jakarta', at)).toBe('WIB · Asia/Jakarta (UTC+7)');
    expect(timezoneSummary('Asia/Makassar', at)).toBe('WITA · Asia/Makassar (UTC+8)');
    expect(timezoneSummary('Singapura', at)).toBe('Singapura');
  });

  it('shows the raw id for a zone outside the list', () => {
    expect(timezoneSummary('Asia/Tokyo', at)).toBe('Asia/Tokyo');
    expect(timezoneDetail('Not/AZone', at)).toBe('Not/AZone');
  });
});
