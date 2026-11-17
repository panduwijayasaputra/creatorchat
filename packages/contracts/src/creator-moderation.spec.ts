import { describe, expect, it } from 'vitest';
import { ModerateCreatorSchema } from './creator-moderation.js';

describe('ModerateCreatorSchema', () => {
  it('trims the reason and strips other keys', () => {
    const out = ModerateCreatorSchema.parse({
      reason: '  Pelanggaran  ',
      status: 'ACTIVE',
      user_id: 'x',
    });
    expect(out).toEqual({ reason: 'Pelanggaran' });
  });

  it.each(['', '   ', 'a'.repeat(301), 'bad\u0000text'])('rejects %j', (reason) => {
    expect(ModerateCreatorSchema.safeParse({ reason }).success).toBe(false);
  });

  it('rejects a missing reason with the board text', () => {
    const r = ModerateCreatorSchema.safeParse({});
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('Alasan wajib diisi.');
  });
});
