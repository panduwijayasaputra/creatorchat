import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InboxResponse } from '@creatorchat/contracts';
import {
  createFakeMiniappApi,
  inboxItem,
  inboxPage,
  networkError,
} from '../../test/fake-miniapp-api';
import { useInbox } from './useInbox';
import { useOnline } from './useOnline';

const ready = (hook: { result: { current: ReturnType<typeof useInbox> } }) => {
  const s = hook.result.current.state;
  if (s.status !== 'ready') throw new Error(`not ready: ${s.status}`);
  return s;
};
const names = (hook: Parameters<typeof ready>[0]) =>
  ready(hook).items.map((i) => i.customer.display_name);

describe('useInbox', () => {
  it('loads the first page with the filter and exposes the unread total', async () => {
    const api = createFakeMiniappApi({
      inbox: [inboxPage([inboxItem(1, { unread_count: 2 }), inboxItem(2)], { next_cursor: 'c1' })],
    });
    const hook = renderHook(() => useInbox(api, 'all'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    expect(api.inboxCalls[0]).toEqual({ filter: 'all', limit: 30 });
    expect(ready(hook).unreadConversations).toBe(1);
    expect(names(hook)).toEqual(['Pelanggan 1', 'Pelanggan 2']);
  });

  it('loadMore appends once, uses the cursor and ignores a second call while loading', async () => {
    let release!: (v: InboxResponse) => void;
    const slow = new Promise<InboxResponse>((r) => (release = r));
    const api = createFakeMiniappApi({
      inbox: [inboxPage([inboxItem(1)], { next_cursor: 'c1' }), slow],
    });
    const hook = renderHook(() => useInbox(api, 'all'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    act(() => {
      hook.result.current.loadMore();
      hook.result.current.loadMore();
    });
    expect(api.inboxCalls).toHaveLength(2);
    expect(api.inboxCalls[1]).toMatchObject({ cursor: 'c1' });
    await act(async () => release(inboxPage([inboxItem(2)])));
    expect(names(hook)).toEqual(['Pelanggan 1', 'Pelanggan 2']);
    expect(ready(hook).nextCursor).toBeNull();
    act(() => hook.result.current.loadMore()); // no cursor left: nothing happens
    expect(api.inboxCalls).toHaveLength(2);
  });

  it('drops rows of a later page that the list already holds', async () => {
    const api = createFakeMiniappApi({
      inbox: [
        inboxPage([inboxItem(1), inboxItem(2)], { next_cursor: 'c1' }),
        inboxPage([inboxItem(2), inboxItem(3)]),
      ],
    });
    const hook = renderHook(() => useInbox(api, 'all'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(ready(hook).items).toHaveLength(3));
    expect(names(hook)).toEqual(['Pelanggan 1', 'Pelanggan 2', 'Pelanggan 3']);
  });

  it('a failed second page keeps the rows and reports failed; the first page failing is an error with retry', async () => {
    const api = createFakeMiniappApi({
      inbox: [inboxPage([inboxItem(1)], { next_cursor: 'c1' }), networkError()],
    });
    const hook = renderHook(() => useInbox(api, 'all'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(ready(hook).more).toBe('failed'));
    expect(names(hook)).toEqual(['Pelanggan 1']);

    const bad = createFakeMiniappApi({ inbox: [networkError(), inboxPage([inboxItem(9)])] });
    const h2 = renderHook(() => useInbox(bad, 'all'));
    await waitFor(() => expect(h2.result.current.state.status).toBe('error'));
    act(() => h2.result.current.retry());
    await waitFor(() => expect(h2.result.current.state.status).toBe('ready'));
  });

  it('switching the filter resets the list, and a slow older answer never overwrites the newer one', async () => {
    let releaseAll!: (v: InboxResponse) => void;
    const slowAll = new Promise<InboxResponse>((r) => (releaseAll = r));
    const api = createFakeMiniappApi({
      inbox: [slowAll, inboxPage([inboxItem(5, { unread_count: 1 })])],
    });
    const hook = renderHook(({ f }) => useInbox(api, f), {
      initialProps: { f: 'all' as 'all' | 'unread' },
    });
    hook.rerender({ f: 'unread' });
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    expect(api.inboxCalls.map((c) => c.filter)).toEqual(['all', 'unread']);
    await act(async () => releaseAll(inboxPage([inboxItem(1)])));
    expect(names(hook)).toEqual(['Pelanggan 5']);
  });

  it('refetches quietly when the tab becomes visible and replaces the list', async () => {
    const api = createFakeMiniappApi({
      inbox: [inboxPage([inboxItem(1)]), inboxPage([inboxItem(2), inboxItem(1)])],
    });
    const hook = renderHook(() => useInbox(api, 'all'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(names(hook)).toEqual(['Pelanggan 2', 'Pelanggan 1']));
  });
});

describe('useOnline', () => {
  it('follows the browser events', () => {
    const hook = renderHook(() => useOnline());
    expect(hook.result.current).toBe(true);
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(hook.result.current).toBe(false);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(hook.result.current).toBe(true);
  });
});
