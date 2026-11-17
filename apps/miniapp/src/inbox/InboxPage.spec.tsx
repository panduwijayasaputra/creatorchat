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
  inboxItem,
  inboxPage,
  maya,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

let observers: { cb: IntersectionObserverCallback }[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T05:00:00.000Z') });
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb });
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(api: FakeMiniappApi, path = '/inbox') {
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=x&hash=y'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const creatorApi = (
  inbox: Parameters<typeof createFakeMiniappApi>[0] extends infer O
    ? O extends { inbox?: infer I }
      ? I
      : never
    : never,
) => createFakeMiniappApi({ me: [maya], inbox });

const board = () =>
  inboxPage(
    [
      inboxItem(1, {
        customer: { display_name: 'Rani Anggraini', avatar_url: null },
        preview: 'Oke, aku coba. Boleh minta rekomendasi tepungnya?',
        last_message_at: '2026-11-17T02:20:00.000Z',
        unread_count: 2,
      }),
      inboxItem(2, {
        customer: { display_name: 'Bayu Setiawan', avatar_url: null },
        preview: 'Kalau mau lebih pedas, tambahannya apa ya?',
        last_message_at: '2026-11-17T01:55:00.000Z',
        unread_count: 1,
      }),
      inboxItem(3, {
        customer: { display_name: 'Nadia Kusuma', avatar_url: null },
        preview: 'Terima kasih banyak ya kak, resepnya enak.',
        last_message_at: '2026-11-06T09:00:00.000Z',
        access_active: false,
      }),
    ],
    { unread_conversations: 2 },
  );

describe('CrInbox', () => {
  it('shows rows with initials, name, preview, time in the account zone, unread badge and the expired chip', async () => {
    mount(creatorApi([board()]));
    expect(await screen.findByText('Rani Anggraini')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText('RA')).toBeInTheDocument();
    expect(
      screen.getByText('Oke, aku coba. Boleh minta rekomendasi tepungnya?'),
    ).toBeInTheDocument();
    expect(screen.getByText('09.20')).toBeInTheDocument();
    expect(screen.getByText('6 Nov')).toBeInTheDocument();
    expect(screen.getByLabelText('2 pesan belum dibaca')).toHaveTextContent('2');
    expect(screen.getByLabelText('1 pesan belum dibaca')).toBeInTheDocument();
    // only Nadia's access ended: one chip, with its label
    expect(screen.getAllByText('Akses berakhir')).toHaveLength(1);
    const rows = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/inbox/'));
    expect(rows[0]).toHaveAttribute('href', '/inbox/33333333-0000-4000-8000-000000000001');
  });

  it('has only the two filter chips: Semua (selected) and Belum Dibaca n; no Phase F chips, search box or Telegram id', async () => {
    mount(creatorApi([board()]));
    await screen.findByText('Rani Anggraini');
    expect(screen.getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Belum Dibaca 2' })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Manual|Perlu Perhatian|AI Aktif|Balasan AI|Cari nama/);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('Belum Dibaca refetches with filter=unread and an empty answer shows the placeholder note', async () => {
    const api = creatorApi([board(), inboxPage([], { unread_conversations: 0 })]);
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Belum Dibaca 2' }));
    expect(await screen.findByText('Tidak ada pesan yang belum dibaca.')).toBeInTheDocument();
    expect(api.inboxCalls.map((c) => c.filter)).toEqual(['all', 'unread']);
    expect(screen.getByRole('button', { name: 'Belum Dibaca' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Semua' }));
    await waitFor(() => expect(api.inboxCalls).toHaveLength(3));
  });

  it('loads the next page once when the end of the list scrolls into view', async () => {
    const api = creatorApi([
      inboxPage([inboxItem(1)], { next_cursor: 'c1' }),
      inboxPage([inboxItem(2)]),
    ]);
    mount(api);
    await screen.findByText('Pelanggan 1');
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));
    act(() => {
      for (const o of observers)
        o.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(await screen.findByText('Pelanggan 2')).toBeInTheDocument();
    expect(api.inboxCalls[1]).toMatchObject({ cursor: 'c1' });
    expect(api.inboxCalls).toHaveLength(2);
  });
});

describe('CrStatesInbox', () => {
  it('loading shows five skeleton rows and no chips', async () => {
    let release!: (v: ReturnType<typeof board>) => void;
    const held = new Promise<ReturnType<typeof board>>((r) => (release = r));
    mount(creatorApi([held]));
    expect(await screen.findByRole('status', { name: 'Memuat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Semua' })).toBeNull();
    release(board());
    expect(await screen.findByText('Rani Anggraini')).toBeInTheDocument();
  });

  it('empty: copy, and Salin Link Profil copies the server link and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const api = creatorApi([inboxPage([])]);
    mount(api);
    expect(await screen.findByText('Belum ada percakapan')).toBeInTheDocument();
    expect(
      screen.getByText('Bagikan link profilmu di bio Instagram agar pelanggan bisa mulai chat.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Semua' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Salin Link Profil' }));
    expect(await screen.findByText('Link disalin')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toMatch(/^https:\/\/t\.me\/.+\?start=c_/);
  });

  it('error: copy and Coba Lagi reloads', async () => {
    const api = creatorApi([networkError(), board()]);
    mount(api);
    expect(await screen.findByText('Inbox gagal dimuat')).toBeInTheDocument();
    expect(
      screen.getByText('Terjadi gangguan saat mengambil percakapan. Coba lagi sebentar.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Rani Anggraini')).toBeInTheDocument();
  });

  it('offline: the panel appears on the offline event, dims the rows and goes away online', async () => {
    mount(creatorApi([board()]));
    await screen.findByText('Rani Anggraini');
    expect(screen.queryByText('Koneksi terputus')).toBeNull();
    act(() => void window.dispatchEvent(new Event('offline')));
    const panel = await screen.findByText('Koneksi terputus');
    expect(
      within(panel.parentElement!).getByText(
        'Menyambungkan ulang… Pesan yang kamu kirim akan dicoba lagi otomatis.',
      ),
    ).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText('Koneksi terputus')).toBeNull());
  });
});
