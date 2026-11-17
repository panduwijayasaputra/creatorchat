import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDevInitData, installServerDevInitData } from './dev-init-data';
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

describe('installServerDevInitData', () => {
  const ok = (initData: string) => vi.fn(async () => Response.json({ initData }));

  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('installs initData signed by the dev server, passing and remembering ?tgdev_* identity', async () => {
    window.history.replaceState(null, '', '/?tgdev_id=9000000001&tgdev_username=salsa_sample');
    const fetchFn = ok('a=1&hash=zz');
    expect(await installServerDevInitData(window, fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('/__dev/initdata?id=9000000001&username=salsa_sample');
    expect(browserTelegram.getInitData()).toBe('a=1&hash=zz');

    delete window.Telegram;
    window.history.replaceState(null, '', '/inbox');
    await installServerDevInitData(window, fetchFn);
    expect(fetchFn).toHaveBeenLastCalledWith('/__dev/initdata?id=9000000001&username=salsa_sample');
  });

  it('leaves the outside-Telegram state when the endpoint is off or fails, and skips real Telegram', async () => {
    const html = vi.fn(async () => new Response('<!doctype html>', { status: 200 }));
    expect(await installServerDevInitData(window, html)).toBe(false);
    const failed = vi.fn(async () => Response.json({ error: 'no token' }, { status: 400 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await installServerDevInitData(window, failed)).toBe(false);
    expect(browserTelegram.getInitData()).toBeNull();

    window.Telegram = { WebApp: { initData: 'real=1', ready() {}, expand() {} } };
    const fetchFn = ok('x');
    expect(await installServerDevInitData(window, fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
