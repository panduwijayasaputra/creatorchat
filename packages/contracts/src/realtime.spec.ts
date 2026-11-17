import { describe, expect, it } from 'vitest';
import { RealtimeAuthSchema, RealtimeEventSchemas, userRoom } from './realtime.js';

const id = '8f14e45f-ceea-4f67-a1b2-0123456789ab';

describe('realtime contracts', () => {
  it('parses each event shape and nothing more', () => {
    const s = RealtimeEventSchemas;
    expect(s['message.created'].safeParse({ conversation_id: id, seq: 3 }).success).toBe(true);
    expect(s['read.updated'].safeParse({ conversation_id: id, through_seq: 0 }).success).toBe(true);
    expect(s['conversation.updated'].safeParse({ conversation_id: id }).success).toBe(true);
    expect(s['session.ended'].safeParse({}).success).toBe(true);
  });

  it('refuses extra keys, a non-uuid id and seq 0', () => {
    const s = RealtimeEventSchemas;
    for (const extra of ['body', 'preview', 'customer_id']) {
      expect(
        s['message.created'].safeParse({ conversation_id: id, seq: 1, [extra]: 'x' }).success,
      ).toBe(false);
      expect(
        s['conversation.updated'].safeParse({ conversation_id: id, [extra]: 'x' }).success,
      ).toBe(false);
    }
    expect(s['message.created'].safeParse({ conversation_id: 'nope', seq: 1 }).success).toBe(false);
    expect(s['message.created'].safeParse({ conversation_id: id, seq: 0 }).success).toBe(false);
  });

  it('has a stable room and requires a token in the handshake', () => {
    expect(userRoom(id)).toBe(`user:${id}`);
    expect(RealtimeAuthSchema.safeParse({ token: 'abc' }).success).toBe(true);
    expect(RealtimeAuthSchema.safeParse({}).success).toBe(false);
    expect(RealtimeAuthSchema.safeParse({ token: '' }).success).toBe(false);
  });
});
