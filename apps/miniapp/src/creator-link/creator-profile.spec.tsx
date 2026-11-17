import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../auth/api-client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreatorAccess,
  CreatorProfileResponse,
  SubmitAccessRequestResponse,
} from '@creatorchat/contracts';
import { createFakeMiniappApi, fakeSeen, fakeTelegram, nadia } from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';
import { CreatorProfileView } from './CreatorProfileView';

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

const base = {
  public_code: 'dinda234',
  display_name: 'Dinda Prameswari',
  bio: 'Memotret kota dan cahaya pagi.',
  avatar_url: null,
  conversation_id: null,
};
const profile = (access: CreatorAccess): CreatorProfileResponse => ({ ...base, access });

function view(
  access: CreatorAccess,
  zone = 'Asia/Jakarta',
  extra: Partial<CreatorProfileResponse> & { sending?: boolean; requestError?: string } = {},
) {
  const onBack = vi.fn();
  const onUnavailable = vi.fn();
  const onRequestAccess = vi.fn();
  const { sending, requestError, ...rest } = extra;
  render(
    <CreatorProfileView
      profile={{ ...profile(access), ...rest }}
      timezone={zone}
      onBack={onBack}
      onUnavailable={onUnavailable}
      onRequestAccess={onRequestAccess}
      {...(sending !== undefined ? { sending } : {})}
      {...(requestError !== undefined ? { requestError } : {})}
    />,
  );
  return { onBack, onUnavailable, onRequestAccess };
}

const LOCKED = 'Galeri tersedia untuk subscriber aktif';

describe('GUEST (CreatorGuest)', () => {
  it('shows the request button, the note and only the locked gallery panel', () => {
    const { onUnavailable } = view({ state: 'GUEST' });
    expect(screen.getByRole('heading', { name: 'Dinda Prameswari' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minta Akses Uji Coba' })).toBeInTheDocument();
    expect(
      screen.getByText('Admin akan meninjau permintaanmu, lalu memberi kabar melalui Telegram.'),
    ).toBeInTheDocument();
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Foto dan video creator terkunci sampai aksesmu aktif. Minta akses uji coba untuk membukanya.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Permintaan akses terkirim')).toBeNull();
    expect(screen.queryByText('Akses telah berakhir')).toBeNull();
    void onUnavailable;
  });
});

describe('PENDING (CreatorPending)', () => {
  it('shows the request card with the sent time in the viewer zone and a disabled status button', () => {
    view({ state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' });
    expect(screen.getByText('Permintaan akses terkirim')).toBeInTheDocument();
    expect(screen.getByText('Dikirim 13 Nov 2026, 10.42 WIB')).toBeInTheDocument();
    const status = screen.getByRole('button', { name: 'Menunggu Persetujuan' });
    expect(status).toBeDisabled();
    expect(
      screen.getByText('Foto dan video terkunci sampai permintaan aksesmu disetujui.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minta Akses Uji Coba' })).toBeNull();
  });

  it('shows the same instant in another zone with that zone label', () => {
    view(
      { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'RENEWAL' },
      'Asia/Makassar',
    );
    expect(screen.getByText('Dikirim 13 Nov 2026, 11.42 WITA')).toBeInTheDocument();
  });
});

describe('ACTIVE (CreatorActive)', () => {
  it('shows the end date and clock, Buka Chat and a gallery placeholder without tiles', () => {
    view({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' });
    expect(screen.getByText('Akses aktif hingga 27 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Berakhir pukul 23.59 WIB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buka Chat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Galeri' })).toBeInTheDocument();
    expect(screen.queryByText(LOCKED)).toBeNull();
  });

  it('the end date follows the viewer zone across midnight', () => {
    view({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }, 'Australia/Sydney');
    expect(screen.getByText('Akses aktif hingga 28 Nov 2026')).toBeInTheDocument();
  });
});

describe('EXPIRED (CreatorExpired)', () => {
  it.each([false, true])(
    'shows the ended copy, both buttons and the locked panel (revoked: %s)',
    (revoked) => {
      view({ state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked });
      expect(screen.getByText('Akses telah berakhir')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Sejak 6 Nov 2026, 23.59 WIB. Media yang sudah ada di chat tetap bisa dibuka.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Minta Perpanjangan Akses' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lihat Riwayat Chat' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Akses telah berakhir, jadi galeri terkunci. Media yang sudah kamu terima di chat tetap bisa dibuka.',
        ),
      ).toBeInTheDocument();
    },
  );
});

describe('every state', () => {
  it.each<CreatorAccess>([
    { state: 'GUEST' },
    { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
    { state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' },
    { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
  ])('shows no media: no gallery tiles, counts, durations or images (%o)', (access) => {
    const { container } = render(
      <CreatorProfileView
        profile={profile(access)}
        timezone="Asia/Jakarta"
        onBack={() => undefined}
        onUnavailable={() => undefined}
        onRequestAccess={() => undefined}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d+:\d{2}/); // no durations
    expect(container.textContent).not.toMatch(/\d+ (foto|video|media)/i);
  });

  it('the request buttons call onRequestAccess; Kembali and the status button do not', async () => {
    const { onUnavailable, onBack, onRequestAccess } = view({ state: 'GUEST' });
    await userEvent.click(screen.getByRole('button', { name: 'Minta Akses Uji Coba' }));
    expect(onRequestAccess).toHaveBeenCalledTimes(1);
    expect(onUnavailable).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRequestAccess).toHaveBeenCalledTimes(1);
    cleanup();
    const pending = view({
      state: 'PENDING',
      requested_at: '2026-11-13T03:42:00.000Z',
      request_type: 'TRIAL',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Menunggu Persetujuan' }));
    expect(pending.onUnavailable).not.toHaveBeenCalled();
  });

  it('renders bio and name as text and shows an https avatar', () => {
    render(
      <CreatorProfileView
        profile={{
          ...base,
          display_name: '<img src=x onerror=alert(1)>',
          bio: '<b>hi</b>',
          avatar_url: 'https://example.test/a.jpg',
          conversation_id: null,
          access: { state: 'GUEST' },
        }}
        timezone="Asia/Jakarta"
        onBack={() => undefined}
        onUnavailable={() => undefined}
        onRequestAccess={() => undefined}
      />,
    );
    expect(
      screen.getByRole('heading', { name: '<img src=x onerror=alert(1)>' }),
    ).toBeInTheDocument();
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.test/a.jpg');
  });
});

describe('as a page', () => {
  function mount(access: CreatorAccess, timezone = 'Asia/Jakarta') {
    const api = createFakeMiniappApi({
      login: [{ ...nadia, timezone }],
      me: [{ ...nadia, timezone }],
      resolve: [profile(access)],
    });
    const router = createMemoryRouter(
      createMiniappRoutes({
        api,
        telegram: fakeTelegram('query_id=1&hash=abc'),
        seen: fakeSeen(true),
      }),
      { initialEntries: ['/creators/dinda234'] },
    );
    render(<RouterProvider router={router} />);
    return { api, router };
  }

  it('shows the profile with the customer bottom navigation and the viewer-zone dates', async () => {
    mount({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }, 'Australia/Sydney');
    expect(await screen.findByText('Akses aktif hingga 28 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
  });

  it('Lihat Riwayat Chat is still a not-yet-built action: info toast, no API call', async () => {
    const { api } = mount({
      state: 'EXPIRED',
      ended_at: '2026-11-06T16:59:59.000Z',
      revoked: false,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Lihat Riwayat Chat' }));
    expect(
      within(screen.getByRole('status')).getByText('Fitur ini belum tersedia.'),
    ).toBeInTheDocument();
    expect(api.resolveCalls).toHaveLength(1);
    expect(api.requestAccessCalls).toHaveLength(0);
  });
});

describe('review result cards (StatesAccess)', () => {
  const rejected = { status: 'REJECTED', reviewed_at: '2026-11-14T02:10:00.000Z' } as const;
  const approved = { status: 'APPROVED', reviewed_at: '2026-11-14T02:10:00.000Z' } as const;

  it('GUEST + rejected: the grey card and "Ajukan Lagi" replace the trial button', async () => {
    const { onRequestAccess } = view({ state: 'GUEST' }, 'Asia/Jakarta', { last_review: rejected });
    expect(screen.getByText('Permintaan belum bisa disetujui')).toBeInTheDocument();
    expect(screen.getByText('Ditinjau 14 Nov 2026, 09.10 WIB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minta Akses Uji Coba' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ajukan Lagi' }));
    expect(onRequestAccess).toHaveBeenCalledTimes(1);
  });

  it('EXPIRED + rejected keeps the ended card and the history button', () => {
    view(
      { state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false },
      'Asia/Jakarta',
      {
        last_review: rejected,
      },
    );
    expect(screen.getByText('Akses telah berakhir')).toBeInTheDocument();
    expect(screen.getByText('Permintaan belum bisa disetujui')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajukan Lagi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lihat Riwayat Chat' })).toBeInTheDocument();
  });

  it('ACTIVE + approved: the green card with the creator name and the end date, plus Buka Chat', () => {
    view({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }, 'Asia/Jakarta', {
      last_review: approved,
    });
    expect(screen.getByText('Akses disetujui')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Permintaanmu sudah disetujui. Kamu bisa membuka chat dengan Dinda Prameswari sekarang.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Berlaku hingga 27 Nov 2026, 23.59 WIB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buka Chat' })).toBeInTheDocument();
  });

  it('no result card while pending, or when the review does not match the state', () => {
    view(
      { state: 'PENDING', requested_at: '2026-11-13T03:42:00.000Z', request_type: 'TRIAL' },
      'Asia/Jakarta',
      {
        last_review: rejected,
      },
    );
    expect(screen.queryByText('Permintaan belum bisa disetujui')).toBeNull();
    cleanup();
    view({ state: 'GUEST' }, 'Asia/Jakarta', { last_review: approved });
    expect(screen.queryByText('Akses disetujui')).toBeNull();
    expect(screen.getByRole('button', { name: 'Minta Akses Uji Coba' })).toBeInTheDocument();
  });

  it('shows no price, payment or checkout words in any state', () => {
    const words = /harga|bayar|pembayaran|checkout|rp\s?\d|idr|beli/i;
    for (const [access, last_review] of [
      [{ state: 'GUEST' }, rejected],
      [{ state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: true }, rejected],
      [{ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }, approved],
    ] as const) {
      const { container } = render(
        <CreatorProfileView
          profile={{ ...profile(access), last_review }}
          timezone="Asia/Jakarta"
          onBack={() => undefined}
          onUnavailable={() => undefined}
          onRequestAccess={() => undefined}
        />,
      );
      expect(container.textContent).not.toMatch(words);
      cleanup();
    }
  });

  it('while sending the request button is disabled with a sending label; a failure shows an alert and keeps it usable', () => {
    view({ state: 'GUEST' }, 'Asia/Jakarta', { sending: true });
    expect(screen.getByRole('button', { name: 'Mengirim…' })).toBeDisabled();
    cleanup();
    view({ state: 'GUEST' }, 'Asia/Jakarta', {
      requestError: 'Permintaan belum terkirim. Coba lagi.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Permintaan belum terkirim');
    expect(screen.getByRole('button', { name: 'Minta Akses Uji Coba' })).toBeEnabled();
  });
});

describe('request flow as a page', () => {
  const pending: CreatorAccess = {
    state: 'PENDING',
    requested_at: '2026-11-17T03:00:00.000Z',
    request_type: 'TRIAL',
  };
  function mount(
    first: CreatorProfileResponse,
    after: (CreatorProfileResponse | Error)[] = [],
    requestAccess: (SubmitAccessRequestResponse | Error)[] = [],
  ) {
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      resolve: [first, ...after],
      requestAccess,
    });
    const router = createMemoryRouter(
      createMiniappRoutes({
        api,
        telegram: fakeTelegram('query_id=1&hash=abc'),
        seen: fakeSeen(true),
      }),
      { initialEntries: ['/creators/dinda234'] },
    );
    render(<RouterProvider router={router} />);
    return api;
  }

  it('guest tap sends one request, then shows CreatorPending with the sent date', async () => {
    const api = mount(profile({ state: 'GUEST' }), [profile(pending)]);
    const button = await screen.findByRole('button', { name: 'Minta Akses Uji Coba' });
    await userEvent.dblClick(button);
    expect(await screen.findByText('Permintaan akses terkirim')).toBeInTheDocument();
    expect(api.requestAccessCalls).toEqual(['dinda234']);
    expect(screen.getByText(/Dikirim 17 Nov 2026/)).toBeInTheDocument();
  });

  it('expired access sends a request and shows pending', async () => {
    const api = mount(
      profile({ state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false }),
      [profile({ ...pending, request_type: 'RENEWAL' })],
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Perpanjangan Akses' }));
    expect(await screen.findByText('Permintaan akses terkirim')).toBeInTheDocument();
    expect(api.requestAccessCalls).toEqual(['dinda234']);
  });

  it('"Ajukan Lagi" after a rejection sends a new request', async () => {
    const api = mount(
      {
        ...profile({ state: 'GUEST' }),
        last_review: { status: 'REJECTED', reviewed_at: '2026-11-14T02:10:00.000Z' },
      },
      [profile(pending)],
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ajukan Lagi' }));
    expect(await screen.findByText('Permintaan akses terkirim')).toBeInTheDocument();
    expect(api.requestAccessCalls).toHaveLength(1);
  });

  it('a failure keeps the profile, shows the error and the button works again', async () => {
    const api = mount(profile({ state: 'GUEST' }), [profile(pending)], [new TypeError('offline')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Akses Uji Coba' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan belum terkirim');
    expect(screen.queryByText('Permintaan akses terkirim')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Minta Akses Uji Coba' }));
    expect(await screen.findByText('Permintaan akses terkirim')).toBeInTheDocument();
    expect(api.requestAccessCalls).toHaveLength(2);
  });

  it('ACCESS_ALREADY_ACTIVE refreshes to the active state', async () => {
    mount(
      profile({ state: 'GUEST' }),
      [profile({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' })],
      [new ApiError(409, 'ACCESS_ALREADY_ACTIVE', 'Access is already active.')],
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Minta Akses Uji Coba' }));
    expect(await screen.findByText(/Akses aktif hingga 27 Nov 2026/)).toBeInTheDocument();
  });
});

describe('links into the chat (US-027)', () => {
  const CONV = '44444444-0000-4000-8000-000000000001';
  function mountWith(response: CreatorProfileResponse) {
    const api = createFakeMiniappApi({ login: [nadia], me: [nadia], resolve: [response] });
    const router = createMemoryRouter(
      createMiniappRoutes({
        api,
        telegram: fakeTelegram('query_id=1&hash=abc'),
        seen: fakeSeen(true),
      }),
      { initialEntries: ['/creators/dinda234'] },
    );
    render(<RouterProvider router={router} />);
    return { api, router };
  }

  it('Buka Chat on an active profile opens the conversation', async () => {
    const { router } = mountWith({
      ...profile({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }),
      conversation_id: CONV,
    });
    const link = await screen.findByRole('link', { name: 'Buka Chat' });
    expect(link).toHaveAttribute('href', `/chats/${CONV}`);
    await userEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chats/${CONV}`));
  });

  it('Buka Chat on the approved card is the same link', async () => {
    mountWith({
      ...profile({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }),
      last_review: { status: 'APPROVED', reviewed_at: '2026-11-14T02:10:00.000Z' },
      conversation_id: CONV,
    });
    expect(await screen.findByText('Akses disetujui')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buka Chat' })).toHaveAttribute(
      'href',
      `/chats/${CONV}`,
    );
  });

  it('Lihat Riwayat Chat on an expired profile opens the conversation', async () => {
    mountWith({
      ...profile({ state: 'EXPIRED', ended_at: '2026-11-06T16:59:59.000Z', revoked: false }),
      conversation_id: CONV,
    });
    expect(await screen.findByRole('link', { name: 'Lihat Riwayat Chat' })).toHaveAttribute(
      'href',
      `/chats/${CONV}`,
    );
  });

  it('without a conversation both stay buttons that show the info toast', async () => {
    mountWith(profile({ state: 'ACTIVE', ends_at: '2026-11-27T16:59:59.000Z' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Buka Chat' }));
    expect(
      within(screen.getByRole('status')).getByText('Fitur ini belum tersedia.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Buka Chat' })).toBeNull();
  });
});
