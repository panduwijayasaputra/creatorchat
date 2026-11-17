import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
  networkError,
  type FakeMiniappApi,
} from '../../test/fake-miniapp-api';
import { ApiError } from '../auth/api-client';
import { createMiniappRoutes } from '../app/routes';

const BLOCK = { creator_name: 'Salsa Maheswari', ends_at: '2026-11-27T00:00:00.000Z' };
const PENDING = {
  id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
  status: 'PENDING' as const,
  creator_name: 'Maya',
  instagram_url: 'https://instagram.com/maya',
  creator_type: 'HUMAN' as const,
  description: 'Resep',
  created_at: '2026-11-16T05:00:00.000Z',
  reviewed_at: null,
  review_reason: null,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mount(options: { user?: typeof nadia; api?: FakeMiniappApi } = {}) {
  const user = options.user ?? nadia;
  const api = options.api ?? createFakeMiniappApi({ login: [user], me: [user] });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/profile/creator-request'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

const name = () => screen.getByLabelText('Nama creator');
const link = () => screen.getByLabelText('Link profil Instagram');
const about = () => screen.getByLabelText('Deskripsi singkat konten');
const rights = () => screen.getByRole('checkbox');
const send = () => screen.getByRole('button', { name: /Kirim Permintaan|Mengirim/ });
const heading = async () => {
  await screen.findByRole('heading', { name: 'Ajukan Jadi Creator', level: 1 });
  await screen.findByLabelText('Nama creator');
};

async function fill(user: ReturnType<typeof userEvent.setup>, opts: { agree?: boolean } = {}) {
  await user.type(link(), 'https://www.instagram.com/maya.lestari/');
  await user.type(about(), 'Resep dan tips masak rumahan.');
  if (opts.agree !== false) await user.click(rights());
}

describe('/profile/creator-request', () => {
  it('shows the form with the display name prefilled and the designed copy', async () => {
    mount();
    await heading();
    expect(name()).toHaveValue('Nadia Putri');
    expect(screen.getByText('Terisi dari nama tampilmu. Bisa diubah.')).toBeInTheDocument();
    expect(screen.getByText('Dipakai admin untuk memeriksa akunmu.')).toBeInTheDocument();
    expect(link()).toHaveAttribute('placeholder', 'https://instagram.com/namaakun');
    expect(about()).toHaveAttribute('placeholder', 'Ceritakan konten yang kamu buat');
    expect(screen.getByText('0/300')).toBeInTheDocument();
    expect(
      screen.getByText('Saya berhak mengelola identitas dan konten creator yang diajukan.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Permintaan akan ditinjau admin\./)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Creator Asli/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(send()).toBeEnabled();
  });

  it('counts the description in code points', async () => {
    const user = userEvent.setup();
    mount();
    await heading();
    await user.type(about(), '😀😀');
    expect(screen.getByText('2/300')).toBeInTheDocument();
  });

  it('moves the type with the arrow keys and sends it', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await heading();
    await fill(user);
    screen.getByRole('radio', { name: /Creator Asli/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Karakter AI/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(send());
    await waitFor(() => expect(api.submitRequestCalls).toHaveLength(1));
    expect(api.submitRequestCalls[0]?.creator_type).toBe('AI_CHARACTER');
  });

  it('shows the three inline errors from the board, sends nothing and focuses the first', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await heading();
    await user.type(link(), 'instagram maya');
    await user.click(send());
    expect(
      screen.getByText('Link Instagram tidak valid. Contoh: https://instagram.com/namaakun'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Deskripsi wajib diisi\./)).toBeInTheDocument();
    expect(screen.getByText('Centang pernyataan ini untuk melanjutkan.')).toBeInTheDocument();
    expect(link()).toHaveAttribute('aria-invalid', 'true');
    expect(link()).toHaveFocus();
    expect(api.submitRequestCalls).toHaveLength(0);
  });

  it('clears an error as soon as it is fixed', async () => {
    const user = userEvent.setup();
    mount();
    await heading();
    await user.click(send());
    expect(screen.getByText('Centang pernyataan ini untuk melanjutkan.')).toBeInTheDocument();
    await user.click(rights());
    expect(screen.queryByText('Centang pernyataan ini untuk melanjutkan.')).not.toBeInTheDocument();
  });

  it('rejects an empty name with the placeholder rule copy', async () => {
    const user = userEvent.setup();
    const { api } = mount();
    await heading();
    await user.clear(name());
    await fill(user);
    await user.click(send());
    expect(screen.getByText('Nama creator wajib diisi.')).toBeInTheDocument();
    expect(name()).toHaveFocus();
    expect(api.submitRequestCalls).toHaveLength(0);
  });

  it('sends the form and goes to the status screen', async () => {
    const user = userEvent.setup();
    const { api, router } = mount();
    await heading();
    await fill(user);
    await user.click(send());
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/profile/creator-request/status'),
    );
    expect(api.submitRequestCalls).toEqual([
      {
        creator_name: 'Nadia Putri',
        instagram_url: 'https://www.instagram.com/maya.lestari/',
        creator_type: 'HUMAN',
        description: 'Resep dan tips masak rumahan.',
        rights_confirmed: true,
      },
    ]);
  });

  it('disables everything while sending and sends once on a double click', async () => {
    const user = userEvent.setup();
    let release: (
      value: Awaited<ReturnType<FakeMiniappApi['submitCreatorRequest']>>,
    ) => void = () => {};
    const api = createFakeMiniappApi({ login: [nadia], me: [nadia] });
    api.submitCreatorRequest = (input) => {
      api.submitRequestCalls.push(input);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    mount({ api });
    await heading();
    await fill(user);
    await user.dblClick(send());
    const busy = await screen.findByRole('button', { name: 'Mengirim…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(name()).toBeDisabled();
    expect(link()).toBeDisabled();
    expect(about()).toBeDisabled();
    expect(rights()).toBeDisabled();
    expect(api.submitRequestCalls).toHaveLength(1);
    release({ request: PENDING });
  });

  it('keeps every typed value and shows the failure banner when the connection is lost, then retries', async () => {
    const user = userEvent.setup();
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      submitRequest: [networkError()],
    });
    const { router } = mount({ api });
    await heading();
    await fill(user);
    await user.click(send());
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Permintaan belum terkirim');
    expect(banner).toHaveTextContent(
      'Koneksi terputus. Isianmu masih ada di sini. Coba kirim lagi.',
    );
    expect(link()).toHaveValue('https://www.instagram.com/maya.lestari/');
    expect(about()).toHaveValue('Resep dan tips masak rumahan.');
    expect(rights()).toBeChecked();
    expect(send()).toBeEnabled();
    await user.click(send());
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/profile/creator-request/status'),
    );
    expect(api.submitRequestCalls).toHaveLength(2);
  });

  it('shows placeholder server text for a 500 and keeps the values', async () => {
    const user = userEvent.setup();
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      submitRequest: [apiError(500, 'INTERNAL_ERROR')],
    });
    mount({ api });
    await heading();
    await fill(user);
    await user.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent('Terjadi kendala di server.');
    expect(about()).toHaveValue('Resep dan tips masak rumahan.');
  });

  it('maps a server 400 to the inline errors', async () => {
    const user = userEvent.setup();
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      submitRequest: [
        new ApiError(400, 'VALIDATION_FAILED', 'x', [
          {
            path: 'instagram_url',
            message: 'Link Instagram tidak valid. Contoh: https://instagram.com/namaakun',
          },
        ]),
      ],
    });
    mount({ api });
    await heading();
    await fill(user);
    await user.click(send());
    expect(
      await screen.findByText('Link Instagram tidak valid. Contoh: https://instagram.com/namaakun'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
  });

  it('switches to the blocked variant when the server answers 409, keeping the values', async () => {
    const user = userEvent.setup();
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      submitRequest: [new ApiError(409, 'CREATOR_REQUEST_BLOCKED', 'x', BLOCK)],
    });
    mount({ api });
    await heading();
    await fill(user);
    await user.click(send());
    expect(await screen.findByText('Belum bisa mengajukan')).toBeInTheDocument();
    expect(link()).toHaveValue('https://www.instagram.com/maya.lestari/');
    expect(link()).toBeDisabled();
    expect(send()).toBeDisabled();
  });

  it('starts in the blocked variant: explanation, disabled fields and button', async () => {
    mount({
      api: createFakeMiniappApi({
        login: [nadia],
        me: [nadia],
        creatorRequestState: [{ request: null, blocked: BLOCK }],
      }),
    });
    expect(await screen.findByText('Belum bisa mengajukan')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Permintaan menjadi creator dapat diajukan setelah seluruh langganan pelanggan berakhir.',
      ),
    ).toBeInTheDocument();
    for (const field of [name(), link(), about(), rights()]) expect(field).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Karakter AI/ })).toBeDisabled();
    expect(send()).toBeDisabled();
  });

  it('sends a user with a pending request to the status screen', async () => {
    const { router } = mount({
      api: createFakeMiniappApi({
        login: [nadia],
        me: [nadia],
        creatorRequestState: [{ request: PENDING, blocked: null }],
      }),
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/profile/creator-request/status'),
    );
  });

  describe('after a rejection (CreatorRequestRetry)', () => {
    const REASON =
      'Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.';
    const REJECTED = {
      ...PENDING,
      status: 'REJECTED' as const,
      creator_name: 'Maya Lestari',
      instagram_url: 'https://instagram.com/maya.lestari',
      creator_type: 'AI_CHARACTER' as const,
      description:
        'Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.',
      reviewed_at: '2026-11-15T00:00:00.000Z',
      review_reason: REASON,
    };
    const retry = (blocked: typeof BLOCK | null = null) =>
      mount({
        api: createFakeMiniappApi({
          login: [nadia],
          me: [nadia],
          creatorRequestState: [{ request: REJECTED, blocked }],
        }),
      });

    it('prefills the rejected values and shows the reason on top', async () => {
      retry();
      await heading();
      expect(screen.getByText(`Alasan penolakan sebelumnya: ${REASON}`)).toBeInTheDocument();
      expect(name()).toHaveValue('Maya Lestari');
      expect(link()).toHaveValue('https://instagram.com/maya.lestari');
      expect(about()).toHaveValue(REJECTED.description);
      expect(screen.getByRole('radio', { name: /Karakter AI/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByText(`${REJECTED.description.length}/300`)).toBeInTheDocument();
    });

    it('starts with the rights statement unchecked and refuses to send until it is checked', async () => {
      const user = userEvent.setup();
      const { api } = retry();
      await heading();
      expect(rights()).not.toBeChecked();
      await user.click(send());
      expect(screen.getByText('Centang pernyataan ini untuk melanjutkan.')).toBeInTheDocument();
      expect(api.submitRequestCalls).toHaveLength(0);
    });

    it('sends the edited values as a new request and goes to the status screen', async () => {
      const user = userEvent.setup();
      const { api, router } = retry();
      await heading();
      await user.clear(link());
      await user.type(link(), 'https://instagram.com/maya.masak');
      await user.click(rights());
      await user.click(send());
      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/profile/creator-request/status'),
      );
      expect(api.submitRequestCalls).toEqual([
        {
          creator_name: 'Maya Lestari',
          instagram_url: 'https://instagram.com/maya.masak',
          creator_type: 'AI_CHARACTER',
          description: REJECTED.description,
          rights_confirmed: true,
        },
      ]);
    });

    it('shows an HTML-looking reason as text', async () => {
      mount({
        api: createFakeMiniappApi({
          login: [nadia],
          me: [nadia],
          creatorRequestState: [
            { request: { ...REJECTED, review_reason: '<b>tebal</b>' }, blocked: null },
          ],
        }),
      });
      await heading();
      expect(screen.getByText('Alasan penolakan sebelumnya: <b>tebal</b>')).toBeInTheDocument();
      expect(document.querySelector('b')).toBeNull();
    });

    it('shows the blocked variant with the prefilled values disabled when a subscription is active', async () => {
      retry(BLOCK);
      expect(await screen.findByText('Belum bisa mengajukan')).toBeInTheDocument();
      expect(name()).toHaveValue('Maya Lestari');
      for (const field of [name(), link(), about(), rights()]) expect(field).toBeDisabled();
      expect(send()).toBeDisabled();
    });
  });

  it('shows the empty form and no reason card for a user without a request', async () => {
    mount();
    await heading();
    expect(screen.queryByText(/Alasan penolakan sebelumnya/)).not.toBeInTheDocument();
    expect(link()).toHaveValue('');
    expect(about()).toHaveValue('');
  });

  it('shows a retry when the state cannot be loaded, then the form', async () => {
    const user = userEvent.setup();
    const api = createFakeMiniappApi({
      login: [nadia],
      me: [nadia],
      creatorRequestState: [networkError()],
    });
    mount({ api });
    expect(await screen.findByText('Form belum bisa dimuat')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByLabelText('Nama creator')).toBeInTheDocument();
    expect(api.creatorRequestStateCalls).toBe(2);
  });

  it('redirects a creator away and never calls the request API', async () => {
    const api = createFakeMiniappApi({ login: [maya], me: [maya] });
    const { router } = mount({ user: maya, api });
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(api.creatorRequestStateCalls).toBe(0);
    expect(api.submitRequestCalls).toHaveLength(0);
  });
});
