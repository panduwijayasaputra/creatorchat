import { describe, expect, it } from 'vitest';
import { AVATAR_TONES, avatarTone, initialsOf, timeLabel } from './inbox-model';

describe('initialsOf', () => {
  it.each([
    ['Rani Anggraini', 'RA'],
    ['Bayu', 'B'],
    ['  nadia   kusuma  putri ', 'NK'],
    ['😀 Dewi', '😀D'],
    ['', ''],
  ])('%j → %j', (name, expected) => expect(initialsOf(name)).toBe(expected));
});

describe('timeLabel', () => {
  const now = new Date('2026-11-17T05:00:00.000Z'); // 12.00 WIB
  it('clock time for today, date for other days', () => {
    expect(timeLabel('2026-11-17T02:20:00.000Z', 'Asia/Jakarta', now)).toBe('09.20');
    expect(timeLabel('2026-11-06T09:00:00.000Z', 'Asia/Jakarta', now)).toBe('6 Nov');
  });
  it('follows the zone around midnight', () => {
    // 18:00Z on the 16th is 01:00 on the 17th in Jakarta (today) but still the 16th in New York
    expect(timeLabel('2026-11-16T18:00:00.000Z', 'Asia/Jakarta', now)).toBe('01.00');
    expect(timeLabel('2026-11-16T18:00:00.000Z', 'America/New_York', now)).toBe('16 Nov');
  });
});

describe('avatarTone', () => {
  it('is stable per id and always one of the board colours', () => {
    const id = '33333333-0000-4000-8000-000000000001';
    expect(avatarTone(id)).toBe(avatarTone(id));
    expect(AVATAR_TONES).toContain(avatarTone(id));
  });
});
