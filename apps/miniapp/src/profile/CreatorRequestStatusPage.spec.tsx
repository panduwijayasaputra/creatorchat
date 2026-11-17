import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatorApplication, CreatorRequestStateResponse } from '@creatorchat/contracts';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  maya,
  nadia,
} from '../../test/fake-miniapp-api';
import { createMiniappRoutes } from '../app/routes';

const BASE: CreatorApplication = {
  id: '0d9b6f0e-7f0c-4a53-9d0c-2b3b5c1a9e33',
  status: 'PENDING',
  creator_name: 'Maya Lestari',
  instagram_url: 'https://instagram.com/maya.lestari',
  creator_type: 'HUMAN',
  description: 'Resep dan tips masak rumahan untuk pemula, dibagikan lewat foto dan video pendek.',
  created_at: '2026-11-16T05:00:00.000Z',
  reviewed_at: null,
  review_reason: null,
};
const REJECTED: CreatorApplication = {
  ...BASE,
  status: 'REJECTED',
  reviewed_at: '2026-11-15T00:00:00.000Z',
  review_reason:
    'Link Instagram belum bisa kami verifikasi. Pastikan akun publik dan sesuai nama creator.',
};
const APPROVED: CreatorApplication = { ...REJECTED, status: 'APPROVED', review_reason: null };

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

function mount(results: (CreatorRequestStateResponse | Error)[], user = nadia) {
  const api = createFakeMiniappApi({ login: [user], me: [user], creatorRequestState: results });
  const router = createMemoryRouter(
    createMiniappRoutes({
      api,
      telegram: fakeTelegram('query_id=1&hash=a'),
      seen: fakeSeen(true),
    }),
    { initialEntries: ['/profile/creator-request/status'] },
  );
  render(<RouterProvider router={router} />);
  return { api, router };
}

describe('/profile/creator-request/status', () => {
  it('shows RequestPending: chip, copy, the submitted values and the way back', async () => {
    mount([{ request: BASE, blocked: null }]);
    expect(await screen.findByText('Sedang Ditinjau')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Status permintaan' })).toBeInTheDocument();
    expect(screen.getByText('Hasil peninjauan akan dikirim melalui Telegram.')).toBeInTheDocument();
    expect(screen.getByText('Maya Lestari')).toBeInTheDocument();
    expect(screen.getByText('@maya.lestari')).toBeInTheDocument();
    expect(screen.getByText('Creator Asli')).toBeInTheDocument();
    expect(screen.getByText(/^Resep dan tips masak rumahan untuk pemula/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Akunmu tetap USER dan dapat memakai fitur pelanggan. Permintaan kedua tidak bisa dibuat selama masih ditinjau.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke Profil' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.queryByText(/DEMO/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Perbaiki dan Ajukan Lagi/ }),
    ).not.toBeInTheDocument();
  });

  it('labels an AI character request "Karakter AI"', async () => {
    mount([{ request: { ...BASE, creator_type: 'AI_CHARACTER' }, blocked: null }]);
    expect(await screen.findByText('Karakter AI')).toBeInTheDocument();
  });

  it('shows RequestRejected with the stored reason verbatim and both buttons', async () => {
    mount([{ request: REJECTED, blocked: null }]);
    expect(await screen.findByText('Ditolak')).toBeInTheDocument();
    expect(
      screen.getByText('Permintaan menjadi creator belum bisa disetujui.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alasan dari admin')).toBeInTheDocument();
    expect(screen.getByText(REJECTED.review_reason as string)).toBeInTheDocument();
    expect(
      screen.getByText('Akunmu tetap USER. Kamu bisa memperbaiki isian lalu mengajukan lagi.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke Profil' })).toBeInTheDocument();
    expect(screen.queryByText('Sedang Ditinjau')).not.toBeInTheDocument();
  });

  it('renders an HTML-looking reason and description as text', async () => {
    const reason = '<img src=x onerror="alert(1)"> <b>tebal</b>';
    mount([{ request: { ...REJECTED, review_reason: reason }, blocked: null }]);
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('"Perbaiki dan Ajukan Lagi" opens the form', async () => {
    const user = userEvent.setup();
    const { router } = mount([
      { request: REJECTED, blocked: null },
      { request: REJECTED, blocked: null },
    ]);
    await user.click(await screen.findByRole('link', { name: 'Perbaiki dan Ajukan Lagi' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile/creator-request'));
  });

  it.each([
    ['no request', null],
    ['an approved request (stale view)', APPROVED],
  ])('goes back to the profile for %s', async (_label, request) => {
    const { router } = mount([{ request, blocked: null }]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });

  it('shows the load failure with a retry, then the screen', async () => {
    const user = userEvent.setup();
    const { api } = mount([new Error('offline'), { request: BASE, blocked: null }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Form belum bisa dimuat');
    await user.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Sedang Ditinjau')).toBeInTheDocument();
    expect(api.creatorRequestStateCalls).toBe(2);
  });

  it('sends the state call only: no request or user id from the client', async () => {
    const { api } = mount([{ request: BASE, blocked: null }]);
    await screen.findByText('Sedang Ditinjau');
    expect(api.creatorRequestStateCalls).toBe(1);
    expect(api.submitRequestCalls).toHaveLength(0);
  });

  it('sends a creator to the inbox and never asks for the state', async () => {
    const { api, router } = mount([{ request: BASE, blocked: null }], maya);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(api.creatorRequestStateCalls).toBe(0);
  });
});
