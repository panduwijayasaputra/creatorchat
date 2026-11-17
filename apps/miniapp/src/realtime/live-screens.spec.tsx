import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_CHATS,
  chatHistory,
  chatMessage,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  inboxItem,
  inboxPage,
  maya,
  nadia,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createFakeRealtime } from '../../test/fake-realtime';
import { createMiniappRoutes } from '../app/routes';

const CONV = '22222222-0000-4000-8000-000000000001';
const OTHER = '22222222-0000-4000-8000-0000000000ff';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(api: FakeMiniappApi, path: string) {
  const rt = createFakeRealtime();
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
      realtime: rt.factory,
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { rt, router };
}
const signal = (rt: ReturnType<typeof createFakeRealtime>, name: string, payload: object) =>
  act(() => rt.last().serverEmit(name, payload));
const nav = () => within(screen.getByRole('navigation', { name: 'Navigasi utama' }));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

describe('open chat (customer)', () => {
  const first = () => chatHistory([chatMessage(1, { body: 'Halo dari awal' })]);
  const second = () =>
    chatHistory([
      chatMessage(2, { body: 'Pesan baru live' }),
      chatMessage(1, { body: 'Halo dari awal' }),
    ]);

  it('shows a new bubble without a reload, once, even when the event repeats', async () => {
    const api = createFakeMiniappApi({ me: [nadia], chatHistory: [first(), second(), second()] });
    const { rt } = mount(api, `/chats/${CONV}`);
    await screen.findByText('Halo dari awal');
    act(() => rt.last().open());
    signal(rt, 'message.created', { conversation_id: CONV, seq: 2 });
    signal(rt, 'message.created', { conversation_id: CONV, seq: 2 });
    expect(await screen.findByText('Pesan baru live')).toBeInTheDocument();
    await settle();
    expect(screen.getAllByText('Pesan baru live')).toHaveLength(1);
    // initial load + one refresh + at most one coalesced re-run
    expect(api.chatHistoryCalls.length).toBeLessThanOrEqual(3);
    expect(api.chatHistoryCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores an event for another conversation', async () => {
    const api = createFakeMiniappApi({ me: [nadia], chatHistory: [first()] });
    const { rt } = mount(api, `/chats/${CONV}`);
    await screen.findByText('Halo dari awal');
    act(() => rt.last().open());
    signal(rt, 'message.created', { conversation_id: OTHER, seq: 2 });
    signal(rt, 'read.updated', { conversation_id: OTHER, through_seq: 2 });
    await settle();
    expect(api.chatHistoryCalls).toHaveLength(1);
  });

  it('updates the "Dibaca" marker after read.updated', async () => {
    const mine = chatMessage(1, { sender: 'ME', body: 'Pesan saya' });
    const api = createFakeMiniappApi({
      me: [nadia],
      chatHistory: [
        chatHistory([mine], { peer_read_seq: 0 }),
        chatHistory([mine], { peer_read_seq: 1 }),
      ],
    });
    const { rt } = mount(api, `/chats/${CONV}`);
    await screen.findByText('Pesan saya');
    expect(screen.queryByText('Dibaca')).toBeNull();
    act(() => rt.last().open());
    signal(rt, 'read.updated', { conversation_id: CONV, through_seq: 1 });
    expect(await screen.findByText('Dibaca')).toBeInTheDocument();
  });

  it('after a reconnect catches up past a gap with no hole, and shows no offline banner', async () => {
    const api = createFakeMiniappApi({
      me: [nadia],
      chatHistory: [
        first(),
        chatHistory([chatMessage(9, { body: 'Terbaru' }), chatMessage(8, { body: 'Sebelumnya' })], {
          next_before: 8,
        }),
      ],
    });
    const { rt } = mount(api, `/chats/${CONV}`);
    await screen.findByText('Halo dari awal');
    act(() => rt.last().open());
    act(() => rt.last().drop());
    expect(screen.queryByText('Koneksi terputus')).toBeNull();
    act(() => rt.last().open());
    expect(await screen.findByText('Terbaru')).toBeInTheDocument();
    expect(screen.getByText('Sebelumnya')).toBeInTheDocument();
    // a gap of more than one page restarts from the newest page, so the old bubble is not shown alone
    expect(screen.queryByText('Halo dari awal')).toBeNull();
  });

  it('re-posts an unsent message once after a reconnect, with the same client id', async () => {
    const api = createFakeMiniappApi({
      me: [nadia],
      chatHistory: [chatHistory([]), chatHistory([])],
      chatSend: [networkError()],
    });
    const { rt } = mount(api, `/chats/${CONV}`);
    await screen.findByText('Salsa Maheswari');
    act(() => rt.last().open());
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Tulis pesan' }),
      'Terkirim nanti{Enter}',
    );
    expect(await screen.findByText('Belum terkirim')).toBeInTheDocument();
    act(() => rt.last().drop());
    act(() => rt.last().open());
    await waitFor(() => expect(api.chatSendCalls).toHaveLength(2));
    expect(api.chatSendCalls[1]!.client_message_id).toBe(api.chatSendCalls[0]!.client_message_id);
    await waitFor(() => expect(screen.queryByText('Belum terkirim')).toBeNull());
    expect(screen.getAllByText('Terkirim nanti')).toHaveLength(1);
  });
});

describe('chat list and nav badge (customer)', () => {
  it('shows the new preview and unread after conversation.updated, and refreshes the badge', async () => {
    const changed = {
      ...BOARD_CHATS,
      items: [
        {
          ...BOARD_CHATS.items[0]!,
          last_message: {
            preview: 'Balasan live dari Salsa',
            at: '2026-11-17T03:00:00.000Z',
            media_kind: null,
          },
          unread_count: 3,
        },
        ...BOARD_CHATS.items.slice(1),
      ],
    };
    const api = createFakeMiniappApi({
      me: [nadia],
      chatList: [BOARD_CHATS, changed],
      chatUnread: [{ unread_total: 2 }, { unread_total: 3 }],
    });
    const { rt } = mount(api, '/chats');
    await screen.findByText('Salsa Maheswari');
    expect(await nav().findByLabelText('2 pesan belum dibaca')).toBeInTheDocument();
    act(() => rt.last().open());
    signal(rt, 'conversation.updated', { conversation_id: BOARD_CHATS.items[0]!.conversation_id });
    expect(await screen.findByText('Balasan live dari Salsa')).toBeInTheDocument();
    expect(await nav().findByLabelText('3 pesan belum dibaca')).toBeInTheDocument();
  });

  it('refetches the list and the badge after a reconnect', async () => {
    const api = createFakeMiniappApi({ me: [nadia] });
    const { rt } = mount(api, '/chats');
    await screen.findByText('Salsa Maheswari');
    const lists = api.chatListCalls.length;
    const unread = api.chatUnreadCalls;
    act(() => rt.last().open());
    act(() => rt.last().drop());
    act(() => rt.last().open());
    await waitFor(() => expect(api.chatListCalls.length).toBe(lists + 1));
    await waitFor(() => expect(api.chatUnreadCalls).toBe(unread + 1));
  });
});

describe('creator inbox', () => {
  it('reorders and updates live; a burst makes one trailing refetch, not one per signal', async () => {
    const before = inboxPage([inboxItem(1, { preview: 'Lama', unread_count: 0 }), inboxItem(2)]);
    const after = inboxPage([
      inboxItem(2, { preview: 'Baru masuk', unread_count: 1 }),
      inboxItem(1, { preview: 'Lama' }),
    ]);
    const api = createFakeMiniappApi({ me: [maya], inbox: [before, after, after, after] });
    const { rt } = mount(api, '/inbox');
    await screen.findByText('Lama');
    act(() => rt.last().open());
    const calls = api.inboxCalls.length;
    for (let i = 0; i < 5; i++) signal(rt, 'conversation.updated', { conversation_id: CONV });
    expect(await screen.findByText('Baru masuk')).toBeInTheDocument();
    await settle();
    expect(api.inboxCalls.length - calls).toBeLessThanOrEqual(2);
    const rows = screen.getAllByRole('link').filter((l) => /Pelanggan/.test(l.textContent ?? ''));
    expect(rows[0]).toHaveTextContent('Pelanggan 2');
  });

  it('shows the offline panel when the socket drops and removes it on reconnect', async () => {
    const api = createFakeMiniappApi({ me: [maya], inbox: [inboxPage([inboxItem(1)])] });
    const { rt } = mount(api, '/inbox');
    await screen.findByText('Pelanggan 1');
    act(() => rt.last().open());
    expect(screen.queryByText('Koneksi terputus')).toBeNull();
    act(() => rt.last().drop());
    expect(await screen.findByText('Koneksi terputus')).toBeInTheDocument();
    expect(screen.getByText(/Menyambungkan ulang/)).toBeInTheDocument();
    act(() => rt.last().open());
    await waitFor(() => expect(screen.queryByText('Koneksi terputus')).toBeNull());
  });

  it('shows no offline panel before the first connect', async () => {
    const api = createFakeMiniappApi({ me: [maya], inbox: [inboxPage([inboxItem(1)])] });
    const { rt } = mount(api, '/inbox');
    await screen.findByText('Pelanggan 1');
    act(() => rt.last().networkError());
    expect(screen.queryByText('Koneksi terputus')).toBeNull();
  });

  it('still shows it for a browser offline event', async () => {
    const api = createFakeMiniappApi({ me: [maya], inbox: [inboxPage([inboxItem(1)])] });
    mount(api, '/inbox');
    await screen.findByText('Pelanggan 1');
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByText('Koneksi terputus')).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event('online')));
  });
});

describe('creator chat', () => {
  it('adds a customer message live', async () => {
    const api = createFakeMiniappApi({
      me: [maya],
      creatorChatHistory: [],
    });
    const { creatorChatHistory, creatorChatMessage } = await import('../../test/fake-miniapp-api');
    api.creatorChatHistoryResults.push(
      creatorChatHistory([creatorChatMessage(1, { body: 'Halo kak' })]),
      creatorChatHistory([
        creatorChatMessage(2, { body: 'Ada pesan baru' }),
        creatorChatMessage(1, { body: 'Halo kak' }),
      ]),
    );
    const { rt } = mount(api, '/inbox/66666666-0000-4000-8000-000000000001');
    await screen.findByText('Halo kak');
    act(() => rt.last().open());
    signal(rt, 'message.created', {
      conversation_id: '66666666-0000-4000-8000-000000000001',
      seq: 2,
    });
    expect(await screen.findByText('Ada pesan baru')).toBeInTheDocument();
  });
});
