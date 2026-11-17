import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatListItem, ChatListResponse } from '@creatorchat/contracts';
import {
  BOARD_CHATS,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  nadia,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const NOW = new Date('2026-11-17T08:00:00.000Z'); // 15.00 in Jakarta

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type ChatListResult = ChatListResponse | Error | Promise<ChatListResponse>;

function mount(options: { chatList?: ChatListResult[]; timezone?: string } = {}) {
  const user = { ...nadia, timezone: options.timezone ?? 'Asia/Jakarta' };
  const api = createFakeMiniappApi({
    login: [user],
    me: [user],
    chatList: options.chatList ?? [],
  });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=abc'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/chats'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const rowOf = (name: string) => screen.getByText(name).closest('a') as HTMLElement;
const item = (n: number, over: Partial<ChatListItem> = {}): ChatListItem => ({
  conversation_id: `55555555-0000-4000-8000-${String(n).padStart(12, '0')}`,
  public_code: `crea${String(n).padStart(4, '2')}`,
  display_name: `Creator ${n}`,
  avatar_url: null,
  last_message: { preview: `Pesan ${n}`, at: '2026-11-17T01:00:00.000Z', media_kind: null },
  unread_count: 0,
  access: 'ACTIVE',
  ...over,
});

describe('rows', () => {
  it('shows the two board rows: Salsa with 09.14 and the badge, Kirana with 6 Nov and the ended chip', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const names = (await screen.findAllByRole('link', { name: /Maheswari|Larasati/ })).map(
      (a) => a.textContent,
    );
    expect(names[0]).toContain('Salsa Maheswari');
    expect(names[1]).toContain('Kirana Larasati');

    const salsa = rowOf('Salsa Maheswari');
    expect(within(salsa).getByText('09.14')).toBeInTheDocument();
    expect(
      within(salsa).getByText(
        'Gagal pertama itu wajar kok. Mulai dari adonan yang agak basah dulu.',
      ),
    ).toBeInTheDocument();
    expect(within(salsa).getByLabelText('2 pesan belum dibaca')).toHaveTextContent('2');
    expect(salsa).toHaveAttribute('href', '/chats/44444444-0000-4000-8000-000000000001');

    const kirana = rowOf('Kirana Larasati');
    expect(within(kirana).getByText('6 Nov')).toBeInTheDocument();
    expect(within(kirana).getByText('Sampai ketemu di sesi berikutnya ya.')).toBeInTheDocument();
    expect(within(kirana).getByText('Akses telah berakhir')).toBeInTheDocument();
    expect(within(kirana).queryByLabelText(/belum dibaca/)).toBeNull();
    expect(kirana).toHaveAttribute('href', '/chats/44444444-0000-4000-8000-000000000002');
  });

  it('shows today as a clock and older as a date in the account zone', async () => {
    mount({
      chatList: [
        {
          items: [
            item(1, {
              last_message: { preview: 'a', at: '2026-11-17T01:30:00.000Z', media_kind: null },
            }),
            item(2, {
              last_message: { preview: 'b', at: '2026-11-16T20:30:00.000Z', media_kind: null },
            }),
          ],
          next_cursor: null,
        },
      ],
      timezone: 'Australia/Sydney', // UTC+11: 12.30 today, and 07.30 on the 17th too
    });
    expect(await screen.findByText('Creator 1')).toBeInTheDocument();
    expect(within(rowOf('Creator 1')).getByText('12.30')).toBeInTheDocument();
    expect(within(rowOf('Creator 2')).getByText('07.30')).toBeInTheDocument();
  });

  it('a creator-blocked row shows the placeholder chip instead of a badge; a conversation without messages says so', async () => {
    mount({
      chatList: [
        {
          items: [
            item(1, { access: 'CREATOR_BLOCKED', unread_count: 3 }),
            item(2, { last_message: null }),
          ],
          next_cursor: null,
        },
      ],
    });
    expect(await screen.findByText('Creator 1')).toBeInTheDocument();
    expect(within(rowOf('Creator 1')).getByText('Creator tidak tersedia')).toBeInTheDocument();
    expect(within(rowOf('Creator 1')).queryByLabelText(/belum dibaca/)).toBeNull();
    const quiet = rowOf('Creator 2');
    expect(within(quiet).getByText('Belum ada pesan')).toBeInTheDocument();
    expect(within(quiet).queryByText(/\d\d\.\d\d/)).toBeNull();
  });

  it('shows 99+ for a large unread count', async () => {
    mount({ chatList: [{ items: [item(1, { unread_count: 150 })], next_cursor: null }] });
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('renders a hostile name and preview as text, and an https avatar', async () => {
    mount({
      chatList: [
        {
          items: [
            item(1, {
              display_name: '<img src=x onerror=alert(1)>',
              avatar_url: 'https://example.test/a.jpg',
              last_message: {
                preview: '<b>hi</b>',
                at: '2026-11-17T01:00:00.000Z',
                media_kind: null,
              },
            }),
          ],
          next_cursor: null,
        },
      ],
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.test/a.jpg');
  });

  it('never shows AI or manual wording or price words', async () => {
    mount();
    await screen.findByText('Salsa Maheswari');
    expect(document.body.textContent).not.toMatch(/\bAI\b|manual|harga|bayar|checkout/i);
  });

  it('opens a chat from its row and the discovery card goes to Jelajahi', async () => {
    const { router } = mount();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await screen.findByText('Salsa Maheswari'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/chats/44444444-0000-4000-8000-000000000001'),
    );
  });

  it('shows the discovery card and sends it to /explore', async () => {
    const { router } = mount();
    const card = (await screen.findByText('Cari creator lain')).closest('a') as HTMLElement;
    expect(within(card).getByText('Lihat profil dan minta akses uji coba.')).toBeInTheDocument();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(card);
    await waitFor(() => expect(router.state.location.pathname).toBe('/explore'));
  });
});

describe('states (StatesChats)', () => {
  it('shows a loading skeleton while the first page is on its way', async () => {
    let release: (value: ChatListResponse) => void = () => undefined;
    mount({ chatList: [new Promise<ChatListResponse>((resolve) => (release = resolve))] });
    expect(await screen.findByRole('status', { name: 'Memuat percakapan…' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    release(BOARD_CHATS);
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
  });

  it('shows the empty state and its Jelajahi Creator button', async () => {
    const { router } = mount({ chatList: [{ items: [], next_cursor: null }] });
    expect(await screen.findByText('Belum ada percakapan')).toBeInTheDocument();
    expect(
      screen.getByText('Percakapan muncul di sini setelah kamu mendapat akses ke creator.'),
    ).toBeInTheDocument();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('link', { name: 'Jelajahi Creator' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/explore'));
  });

  it('shows the error state and Coba Lagi reloads', async () => {
    const { api } = mount({ chatList: [new Error('boom'), BOARD_CHATS] });
    expect(await screen.findByText('Chat gagal dimuat')).toBeInTheDocument();
    expect(
      screen.getByText('Terjadi gangguan saat mengambil percakapanmu. Coba lagi sebentar.'),
    ).toBeInTheDocument();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
    expect(api.chatListCalls).toHaveLength(2);
  });
});

describe('paging', () => {
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  it('Muat lagi appends the next page by cursor without duplicates', async () => {
    const { api } = mount({
      chatList: [
        { items: [item(1), item(2)], next_cursor: 'cur-1' },
        { items: [item(2), item(3)], next_cursor: null },
      ],
    });
    await user().click(await screen.findByRole('button', { name: 'Muat lagi' }));
    expect(await screen.findByText('Creator 3')).toBeInTheDocument();
    expect(screen.getAllByText('Creator 2')).toHaveLength(1);
    expect(api.chatListCalls[1]).toEqual({ cursor: 'cur-1', limit: 20 });
    expect(screen.queryByRole('button', { name: 'Muat lagi' })).toBeNull();
  });

  it('a failed page keeps the rows, shows a message and can be retried', async () => {
    mount({
      chatList: [
        { items: [item(1)], next_cursor: 'cur-1' },
        new Error('offline'),
        { items: [item(2)], next_cursor: null },
      ],
    });
    await user().click(await screen.findByRole('button', { name: 'Muat lagi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Percakapan belum termuat.');
    expect(screen.getByText('Creator 1')).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Muat lagi' }));
    expect(await screen.findByText('Creator 2')).toBeInTheDocument();
  });

  it('sends one request on a double tap', async () => {
    let release: (value: ChatListResponse) => void = () => undefined;
    const { api } = mount({
      chatList: [
        { items: [item(1)], next_cursor: 'cur-1' },
        new Promise<ChatListResponse>((resolve) => (release = resolve)),
      ],
    });
    await user().dblClick(await screen.findByRole('button', { name: 'Muat lagi' }));
    expect(api.chatListCalls).toHaveLength(2);
    release({ items: [item(2)], next_cursor: null });
    expect(await screen.findByText('Creator 2')).toBeInTheDocument();
  });
});

describe('routing', () => {
  it('a CREATOR never reaches the list and the API is not called', async () => {
    const creator = { ...nadia, role: 'CREATOR' as const };
    const api = createFakeMiniappApi({ login: [creator], me: [creator] });
    const router = createMemoryRouter(
      createMiniappRoutes({
        api,
        telegram: fakeTelegram('query_id=1&hash=abc'),
        seen: fakeSeen(true),
      }),
      { initialEntries: ['/chats'] },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(api.chatListCalls).toHaveLength(0);
  });
});
