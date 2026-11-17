import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';
import { UNREAD_THROTTLE_MS } from './UnreadProvider';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(
  options: {
    unread?: Parameters<typeof createFakeMiniappApi>[0] extends infer O
      ? O extends { chatUnread?: infer R }
        ? R
        : never
      : never;
    creatorUnread?: { unread_conversations: number }[];
    user?: typeof nadia;
    path?: string;
    unreadCount?: number;
  } = {},
) {
  const user = options.user ?? nadia;
  const api = createFakeMiniappApi({
    login: [user],
    me: [user],
    chatUnread: options.unread ?? [],
    creatorUnread: options.creatorUnread ?? [],
  });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=abc'),
      seen: fakeSeen(true),
      ...(options.unreadCount !== undefined ? { unreadCount: options.unreadCount } : {}),
    }),
    { initialEntries: [options.path ?? '/explore'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const nav = () => screen.getByRole('navigation', { name: 'Navigasi utama' });
const chatBadge = () => within(nav()).queryByLabelText(/pesan belum dibaca/);

describe('bottom-nav badge', () => {
  it('shows the server total on the Chat tab', async () => {
    mount({ unread: [{ unread_total: 2 }] });
    await waitFor(() => expect(chatBadge()).toHaveTextContent('2'));
  });

  it('shows 99+ above 99 and nothing at 0', async () => {
    mount({ unread: [{ unread_total: 150 }] });
    await waitFor(() => expect(chatBadge()).toHaveTextContent('99+'));
    cleanup();
    mount({ unread: [{ unread_total: 0 }] });
    await screen.findByRole('navigation', { name: 'Navigasi utama' });
    await waitFor(() => expect(chatBadge()).toBeNull());
  });

  it('shows no badge before the first answer arrives', async () => {
    let release: (value: { unread_total: number }) => void = () => undefined;
    const { api } = mount();
    api.getChatUnread = vi.fn(
      () => new Promise<{ unread_total: number }>((resolve) => (release = resolve)),
    );
    await screen.findByRole('navigation', { name: 'Navigasi utama' });
    expect(chatBadge()).toBeNull();
    act(() => release({ unread_total: 4 }));
  });

  it('the unreadCount option still overrides the server count (tests)', async () => {
    mount({ unreadCount: 7, unread: [{ unread_total: 2 }] });
    await waitFor(() => expect(chatBadge()).toHaveTextContent('7'));
  });

  it('keeps the last value when a refresh fails', async () => {
    const { api } = mount({ unread: [{ unread_total: 3 }, new Error('offline')] });
    await waitFor(() => expect(chatBadge()).toHaveTextContent('3'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(api.chatUnreadCalls).toBe(2));
    expect(chatBadge()).toHaveTextContent('3');
  });

  it('refetches when the tab becomes visible, not when it is hidden', async () => {
    const { api } = mount({ unread: [{ unread_total: 1 }, { unread_total: 5 }] });
    await waitFor(() => expect(chatBadge()).toHaveTextContent('1'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.chatUnreadCalls).toBe(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(chatBadge()).toHaveTextContent('5'));
  });
});

describe('route changes', () => {
  it('refetch on navigation but not more than once per throttle window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T08:00:00.000Z'));
    const { api } = mount({
      unread: [{ unread_total: 1 }, { unread_total: 2 }, { unread_total: 3 }],
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await waitFor(() => expect(api.chatUnreadCalls).toBe(1));
    const tab = (name: string) => within(nav()).getByRole('link', { name });

    await user.click(tab('Langganan'));
    await screen.findByRole('heading', { name: 'Langganan' });
    expect(api.chatUnreadCalls).toBe(1); // inside the window

    vi.setSystemTime(new Date(Date.now() + UNREAD_THROTTLE_MS + 1));
    await user.click(tab('Jelajahi'));
    await waitFor(() => expect(api.chatUnreadCalls).toBe(2));
    await waitFor(() => expect(chatBadge()).toHaveTextContent('2'));
  });
});

describe('who fetches', () => {
  const creator = { ...maya, role: 'CREATOR' } as typeof nadia;

  it('a CREATOR asks for the conversation count, never the customer count, and gets the Inbox badge', async () => {
    const { api } = mount({ user: creator, path: '/inbox' });
    await screen.findByRole('navigation', { name: 'Navigasi creator' });
    expect(await screen.findByLabelText('2 percakapan belum dibaca')).toHaveTextContent('2');
    expect(api.creatorUnreadCalls).toBeGreaterThan(0);
    expect(api.chatUnreadCalls).toBe(0);
  });

  it('a customer never asks for the creator count', async () => {
    const { api } = mount({ path: '/chats' });
    await screen.findByRole('navigation', { name: 'Navigasi utama' });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.creatorUnreadCalls).toBe(0);
  });

  it('shows no creator badge at 0', async () => {
    mount({ user: creator, path: '/inbox', creatorUnread: [{ unread_conversations: 0 }] });
    await screen.findByRole('navigation', { name: 'Navigasi creator' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText(/percakapan belum dibaca/)).toBeNull();
  });
});
