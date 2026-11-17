import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitAccessRequestResponse, SubscriptionsResponse } from '@creatorchat/contracts';
import {
  BOARD_SUBSCRIPTIONS,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  nadia,
} from '../../test/fake-miniapp-api';
import { ApiError } from '../auth/api-client';
import { createMiniappRoutes } from '../app/routes';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  options: {
    subscriptions?: (SubscriptionsResponse | Error)[];
    requestAccess?: (SubmitAccessRequestResponse | Error)[];
    timezone?: string;
    path?: string;
  } = {},
) {
  const user = { ...nadia, timezone: options.timezone ?? 'Asia/Jakarta' };
  const api = createFakeMiniappApi({
    login: [user],
    me: [user],
    subscriptions: options.subscriptions ?? [],
    ...(options.requestAccess ? { requestAccess: options.requestAccess } : {}),
  });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=abc'),
      seen: fakeSeen(true),
    }),
    { initialEntries: [options.path ?? '/subscriptions'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const cardOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('cards', () => {
  it('shows the three board cards in order with chips, date lines, buttons and the footer', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Langganan' })).toBeInTheDocument();
    await screen.findByText('Salsa Maheswari');
    const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(names[0]).toContain('Salsa Maheswari');
    expect(names[1]).toContain('Dinda Prameswari');
    expect(names[2]).toContain('Kirana Larasati');

    const salsa = cardOf('Salsa Maheswari');
    expect(within(salsa).getByText('Aktif')).toBeInTheDocument();
    expect(
      within(salsa).getByText('Akses aktif hingga 27 Nov 2026, 23.59 WIB'),
    ).toBeInTheDocument();
    expect(within(salsa).getByRole('link', { name: 'Buka Chat' })).toHaveAttribute(
      'href',
      '/chats/44444444-0000-4000-8000-000000000001',
    );
    expect(within(salsa).getByRole('link', { name: 'Profil' })).toHaveAttribute(
      'href',
      '/creators/salsa234',
    );

    const dinda = cardOf('Dinda Prameswari');
    expect(within(dinda).getByText('Menunggu')).toBeInTheDocument();
    expect(
      within(dinda).getByText('Diminta 13 Nov 2026, 10.42 WIB · menunggu persetujuan admin'),
    ).toBeInTheDocument();
    expect(within(dinda).getByRole('link', { name: 'Profil' })).toHaveAttribute(
      'href',
      '/creators/dinda234',
    );
    expect(within(dinda).queryByRole('button')).toBeNull();

    const kirana = cardOf('Kirana Larasati');
    expect(within(kirana).getByText('Berakhir')).toBeInTheDocument();
    expect(
      within(kirana).getByText('Akses telah berakhir 6 Nov 2026, 23.59 WIB'),
    ).toBeInTheDocument();
    expect(
      within(kirana).getByRole('button', { name: 'Minta Perpanjangan Akses' }),
    ).toBeInTheDocument();
    expect(within(kirana).queryByRole('link')).toBeNull();

    expect(
      screen.getByText(
        'Setiap creator punya periode akses sendiri. Semua waktu memakai WIB (UTC+7).',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
  });

  it('shows dates and the footer in the account zone', async () => {
    mount({ timezone: 'Australia/Sydney' });
    const salsa = (await screen.findByText('Salsa Maheswari')).closest('li') as HTMLElement;
    expect(within(salsa).getByText(/^Akses aktif hingga 28 Nov 2026, 03\.59 /)).toBeInTheDocument();
    expect(screen.getByText(/Semua waktu memakai .*\(UTC\+11\)\./)).toBeInTheDocument();
  });

  it('Buka Chat opens the conversation of that creator', async () => {
    const { router } = mount();
    await userEvent.click(await screen.findByRole('link', { name: 'Buka Chat' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/chats/44444444-0000-4000-8000-000000000001'),
    );
  });

  it('without a conversation Buka Chat falls back to the info toast and calls no API', async () => {
    const { api } = mount({
      subscriptions: [{ items: [{ ...BOARD_SUBSCRIPTIONS.items[0]!, conversation_id: null }] }],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Buka Chat' }));
    expect(
      within(screen.getByRole('status')).getByText('Fitur ini belum tersedia.'),
    ).toBeInTheDocument();
    expect(api.requestAccessCalls).toHaveLength(0);
  });

  it('an unavailable creator keeps its state and dates but has no buttons, no link and a note', async () => {
    mount({
      subscriptions: [
        {
          items: [
            { ...BOARD_SUBSCRIPTIONS.items[0]!, creator_available: false },
            { ...BOARD_SUBSCRIPTIONS.items[2]!, creator_available: false },
          ],
        },
      ],
    });
    const salsa = (await screen.findByText('Salsa Maheswari')).closest('li') as HTMLElement;
    expect(
      within(salsa).getByText('Akses aktif hingga 27 Nov 2026, 23.59 WIB'),
    ).toBeInTheDocument();
    expect(within(salsa).getByText('Creator sedang tidak tersedia.')).toBeInTheDocument();
    for (const li of screen.getAllByRole('listitem')) {
      expect(within(li).queryByRole('button')).toBeNull();
      expect(within(li).queryByRole('link')).toBeNull();
    }
  });

  it('renders a hostile name as text and an https avatar', async () => {
    mount({
      subscriptions: [
        {
          items: [
            {
              ...BOARD_SUBSCRIPTIONS.items[0]!,
              display_name: '<img src=x onerror=alert(1)>',
              avatar_url: 'https://example.test/a.jpg',
            },
          ],
        },
      ],
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.test/a.jpg');
  });

  it('shows no price, payment or checkout words', async () => {
    mount();
    await screen.findByText('Salsa Maheswari');
    expect(document.body.textContent).not.toMatch(
      /harga|bayar|pembayaran|checkout|rp\s?\d|idr|beli/i,
    );
  });
});

describe('Minta Perpanjangan Akses', () => {
  const pending = {
    items: [
      BOARD_SUBSCRIPTIONS.items[0]!,
      {
        ...BOARD_SUBSCRIPTIONS.items[2]!,
        access: {
          state: 'PENDING' as const,
          requested_at: '2026-11-17T03:00:00.000Z',
          request_type: 'RENEWAL' as const,
        },
      },
    ],
  };

  it('sends one request on a double tap, then the card turns Menunggu', async () => {
    const { api } = mount({ subscriptions: [BOARD_SUBSCRIPTIONS, pending] });
    await userEvent.dblClick(
      await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }),
    );
    await waitFor(() =>
      expect(within(cardOf('Kirana Larasati')).getByText('Menunggu')).toBeInTheDocument(),
    );
    expect(api.requestAccessCalls).toEqual(['kirana23']);
    expect(api.subscriptionCalls).toBe(2);
    expect(within(cardOf('Kirana Larasati')).queryByRole('button')).toBeNull();
  });

  it('disables the button while sending', async () => {
    let release: () => void = () => undefined;
    const { api } = mount({ subscriptions: [BOARD_SUBSCRIPTIONS, pending] });
    api.requestAccess = vi.fn(
      () =>
        new Promise<SubmitAccessRequestResponse>((resolve) => {
          release = () =>
            resolve({ request_type: 'RENEWAL', requested_at: '2026-11-17T03:00:00.000Z' });
        }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }));
    expect(await screen.findByRole('button', { name: 'Mengirim…' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mengirim…' })).toBeNull());
  });

  it('a failure keeps the card, shows the message and the button works again', async () => {
    const { api } = mount({
      subscriptions: [BOARD_SUBSCRIPTIONS, pending],
      requestAccess: [new TypeError('offline')],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan belum terkirim');
    expect(within(cardOf('Kirana Larasati')).getByText('Berakhir')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Minta Perpanjangan Akses' }));
    await waitFor(() =>
      expect(within(cardOf('Kirana Larasati')).getByText('Menunggu')).toBeInTheDocument(),
    );
    expect(api.requestAccessCalls).toHaveLength(2);
  });

  it('ACCESS_ALREADY_ACTIVE and CREATOR_NOT_FOUND refetch instead of failing', async () => {
    for (const code of ['ACCESS_ALREADY_ACTIVE', 'CREATOR_NOT_FOUND'] as const) {
      cleanup();
      const { api } = mount({
        subscriptions: [BOARD_SUBSCRIPTIONS, { items: [BOARD_SUBSCRIPTIONS.items[0]!] }],
        requestAccess: [new ApiError(code === 'CREATOR_NOT_FOUND' ? 404 : 409, code, 'x')],
      });
      await userEvent.click(
        await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }),
      );
      await waitFor(() => expect(screen.queryByText('Kirana Larasati')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(api.subscriptionCalls).toBe(2);
    }
  });

  it('keeps the old list and shows the message when the refetch fails', async () => {
    mount({ subscriptions: [BOARD_SUBSCRIPTIONS, new TypeError('offline')] });
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan belum terkirim');
    expect(screen.getByText('Salsa Maheswari')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('shows a loading skeleton, then the empty state with a way to Jelajahi', async () => {
    const { router } = mount({ subscriptions: [{ items: [] }] });
    expect(await screen.findByText('Belum ada langganan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Langganan' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Jelajahi Creator' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/explore'));
  });

  it('shows the error state and retries', async () => {
    const { api } = mount({ subscriptions: [new Error('boom'), BOARD_SUBSCRIPTIONS] });
    expect(await screen.findByText('Langganan gagal dimuat')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
    expect(api.subscriptionCalls).toBe(2);
  });
});

describe('routing', () => {
  it('redirects a CREATOR to the inbox', async () => {
    const creator = { ...nadia, role: 'CREATOR' as const };
    const api = createFakeMiniappApi({ login: [creator], me: [creator] });
    const router = createMemoryRouter(
      createMiniappRoutes({
        api,
        telegram: fakeTelegram('query_id=1&hash=abc'),
        seen: fakeSeen(true),
      }),
      { initialEntries: ['/subscriptions'] },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(api.subscriptionCalls).toBe(0);
  });
});
