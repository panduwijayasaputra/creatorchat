import { describe, expect, it } from 'vitest';
import { buildBioLink } from './bio-link.js';

describe('buildBioLink', () => {
  it('builds the format the bot accepts', () => {
    expect(buildBioLink('CreatorChatBot', 'k4m5x2qa')).toBe(
      'https://t.me/CreatorChatBot?start=c_k4m5x2qa',
    );
  });
  it('returns null for an unset or unsafe bot username', () => {
    for (const name of [undefined, '', 'Bad Name', 'x&start=y', '../x', 'abcd', '<bot_username>']) {
      expect(buildBioLink(name, 'k4m5x2qa')).toBeNull();
    }
  });
});
