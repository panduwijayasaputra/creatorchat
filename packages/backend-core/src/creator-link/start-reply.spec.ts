import { describe, expect, it } from 'vitest';
import { BOT_COPY } from './bot-copy.js';
import { buildStartReply } from './start-reply.js';

const MINI = 'https://app.example.test';

describe('buildStartReply', () => {
  it('opens the creator route for a c_ payload', () => {
    const reply = buildStartReply({ payload: 'c_k4m5x2qa', miniAppUrl: MINI });
    expect(reply?.url).toBe('https://app.example.test/creators/k4m5x2qa');
    expect(reply?.text).toBe(BOT_COPY.creatorLink);
  });

  it('still builds a URL for a well-formed but unknown code (the server answers "tidak tersedia")', () => {
    expect(buildStartReply({ payload: 'c_UNKNOWN', miniAppUrl: MINI })?.url).toBe(
      'https://app.example.test/creators/UNKNOWN',
    );
  });

  it('keeps a path on the configured Mini App URL out of the destination', () => {
    const reply = buildStartReply({
      payload: 'c_k4m5x2qa',
      miniAppUrl: `${MINI}/ignored/path?x=1`,
    });
    expect(reply?.url).toBe('https://app.example.test/creators/k4m5x2qa');
  });

  it.each([undefined, '', '   ', 'x_abc', 'c_', `c_${'a'.repeat(70)}`])(
    'opens the app without a destination for payload %j',
    (payload) => {
      const reply = buildStartReply({ payload, miniAppUrl: MINI });
      expect(reply?.url).toBe('https://app.example.test/');
      expect(reply?.text).toBe(BOT_COPY.welcome);
    },
  );

  it.each([
    'c_../../x',
    'c_a?b',
    'c_<script>',
    '//evil.com',
    '@evil.com',
    'c_a/b',
    'c_a b',
    'c_a#b',
  ])('never leaves the configured origin for %j', (payload) => {
    const reply = buildStartReply({ payload, miniAppUrl: MINI });
    expect(reply).not.toBeNull();
    expect(new URL(reply!.url).origin).toBe('https://app.example.test');
    expect(reply!.url).toBe('https://app.example.test/');
  });

  it('returns null when the Mini App URL is missing or invalid', () => {
    expect(buildStartReply({ payload: 'c_k4m5x2qa', miniAppUrl: undefined })).toBeNull();
    expect(buildStartReply({ payload: 'c_k4m5x2qa', miniAppUrl: 'not a url' })).toBeNull();
  });
});
