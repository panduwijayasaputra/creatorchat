import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDevInitData } from './dev-init-data';
import { botUrl, browserTelegram } from './webapp';

afterEach(() => {
  delete window.Telegram;
});

describe('browserTelegram', () => {
  it('reads initData from the Telegram WebApp, and null when absent or empty', () => {
    expect(browserTelegram.getInitData()).toBeNull();
    window.Telegram = { WebApp: { initData: '', ready() {}, expand() {} } };
    expect(browserTelegram.getInitData()).toBeNull();
    window.Telegram = { WebApp: { initData: 'a=b', ready() {}, expand() {} } };
    expect(browserTelegram.getInitData()).toBe('a=b');
  });

  it('signals ready and expands inside Telegram, and is a no-op outside', () => {
    expect(() => browserTelegram.signalReady()).not.toThrow();
    const ready = vi.fn();
    const expand = vi.fn();
    window.Telegram = { WebApp: { initData: 'a=b', ready, expand } };
    browserTelegram.signalReady();
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });
});

describe('botUrl', () => {
  it('builds a t.me link from a valid username', () => {
    expect(botUrl('CreatorChatBot')).toBe('https://t.me/CreatorChatBot');
    expect(botUrl('@CreatorChatBot')).toBe('https://t.me/CreatorChatBot');
  });

  it('returns null for missing, placeholder or malformed usernames', () => {
    for (const bad of [undefined, '', '<bot_username>', 'a b', 'x', 'javascript:alert(1)']) {
      expect(botUrl(bad)).toBeNull();
    }
  });
});

describe('installDevInitData', () => {
  it('fakes the WebApp from ?tgdev', () => {
    expect(installDevInitData('?tgdev=a%3D1%26hash%3Dzz')).toBe(true);
    expect(browserTelegram.getInitData()).toBe('a=1&hash=zz');
  });

  it('does nothing without the parameter or when Telegram is really present', () => {
    expect(installDevInitData('')).toBe(false);
    expect(browserTelegram.getInitData()).toBeNull();
    window.Telegram = { WebApp: { initData: 'real=1', ready() {}, expand() {} } };
    expect(installDevInitData('?tgdev=fake')).toBe(false);
    expect(browserTelegram.getInitData()).toBe('real=1');
  });
});
