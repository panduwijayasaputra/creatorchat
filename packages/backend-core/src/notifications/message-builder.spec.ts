import { describe, expect, it } from 'vitest';
import { buildBotMessage } from './message-builder.js';

const base = {
  text: 'Halo',
  buttonText: 'Buka Aplikasi',
  miniAppUrl: 'https://app.example.test/x?y=1',
};

describe('buildBotMessage', () => {
  it('puts the button on the configured origin, with the path when given', () => {
    expect(buildBotMessage(base)?.url).toBe('https://app.example.test/');
    expect(buildBotMessage({ ...base, path: '/chats/abc-123' })?.url).toBe(
      'https://app.example.test/chats/abc-123',
    );
    expect(buildBotMessage({ ...base, path: '/subscriptions' })).toMatchObject({
      text: 'Halo',
      buttonText: 'Buka Aplikasi',
    });
  });

  it('refuses a path that could leave the origin or carry a query', () => {
    for (const path of [
      '//evil',
      '//evil.test/x',
      '/..',
      '/a/../b',
      '/a?x=1',
      '/a#b',
      'chats/1',
      'https://evil.test/',
      '/a b',
      `/${'a'.repeat(81)}`,
    ]) {
      expect(buildBotMessage({ ...base, path }), path).toBeNull();
    }
  });

  it('is null without a usable Mini App URL', () => {
    for (const bad of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://x.test']) {
      expect(buildBotMessage({ ...base, miniAppUrl: bad })).toBeNull();
    }
  });
});
