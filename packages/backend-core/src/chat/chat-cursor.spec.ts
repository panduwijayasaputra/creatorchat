import { describe, expect, it } from 'vitest';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor.js';

const id = '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33';
const at = new Date('2026-11-17T02:14:00.123Z');
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('chat cursor', () => {
  it('round-trips the activity time and the id', () => {
    const decoded = decodeChatCursor(encodeChatCursor({ at, id }));
    expect(decoded).toEqual({ at, id });
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'a b!'],
    ['padding', `${encodeChatCursor({ at, id })}=`],
    ['no separator', b64(at.toISOString())],
    ['extra part', b64(`${at.toISOString()}|${id}|x`)],
    ['bad id', b64(`${at.toISOString()}|nope`)],
    ['sql in the id', b64(`${at.toISOString()}|${id}' OR 1=1 --`)],
    ['date without millis', b64(`2026-11-17T02:14:00Z|${id}`)],
    ['impossible date', b64(`2026-02-31T02:14:00.000Z|${id}`)],
    ['not iso', b64(`yesterday|${id}`)],
    ['plain text', 'hello'],
  ])('refuses %s', (_name, value) => {
    expect(decodeChatCursor(value)).toBeNull();
  });
});
