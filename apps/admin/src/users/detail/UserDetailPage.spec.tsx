import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserDetailResponse } from '@creatorchat/contracts';
import { ApiError } from '../../auth/api-client';
import { HISTORY_ROWS } from '../../../test/creator-detail-fixtures';
import {
  CREATOR_ID,
  DIMAS,
  PENDING_DETAIL,
  PENDING_REQ,
  RAKA,
  REJECTED_DETAIL,
  REJECTED_REQ,
  REQUESTS,
  USER_ID,
} from '../../../test/user-detail-fixtures';
import { LUNA, MAYA } from '../../preview/review-fixtures';
import { RequestDetailPage, type RequestDetailApi } from './RequestDetailPage';
import { UserDetailPage, type UserDetailPageApi } from './UserDetailPage';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const NOW = '2026-11-16T08:00:00.000Z';

function setup(
  options: {
    detail?: (id: string) => Promise<UserDetailResponse>;
    url?: string;
    api?: Record<string, unknown>;
  } = {},
) {
  const api = {
    getUserDetail: vi.fn(options.detail ?? (async () => RAKA)),
    listUserRequests: vi.fn(async () => REQUESTS),
    getUserRequest: vi.fn(async (_id: string, reqId: string) =>
      reqId === REJECTED_REQ ? REJECTED_DETAIL : PENDING_DETAIL,
    ),
    listAccessRequests: vi.fn(async () => ({ items: [] })),
    listUserSubscriptions: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 10 as const,
    })),
    listUserHistory: vi.fn(async () => ({
      items: HISTORY_ROWS,
      total: 4,
      page: 1,
      page_size: 10 as const,
    })),
    getCreatorRequest: vi.fn(async () => ({
      request: MAYA,
      check: { block: null, checked_at: NOW },
    })),
    approveCreatorRequest: vi.fn(async (id: string) => ({
      request: { ...MAYA, id, status: 'APPROVED' as const, reviewed_at: NOW },
      creator: { id: CREATOR_ID, public_code: 'k4m5x2qa' },
    })),
    rejectCreatorRequest: vi.fn(async (id: string, reason: string) => ({
      request: {
        ...LUNA,
        id,
        status: 'REJECTED' as const,
        reviewed_at: NOW,
        review_reason: reason,
      },
    })),
    getUserBlockCheck: vi.fn(async () => ({
      user_status: 'ACTIVE' as const,
      role: 'USER' as const,
      active_subscriptions: 1,
      checked_at: NOW,
    })),
    blockUser: vi.fn(async (id: string) => ({ user: { id, status: 'BLOCKED' as const } })),
    unblockUser: vi.fn(async (id: string) => ({ user: { id, status: 'ACTIVE' as const } })),
    ...options.api,
  };
  render(
    <MemoryRouter initialEntries={[options.url ?? `/users/${USER_ID}`]}>
      <Routes>
        <Route path="/users" element={<div>list</div>} />
        <Route
          path="/users/:id"
          element={<UserDetailPage api={api as unknown as UserDetailPageApi} />}
        />
        <Route
          path="/users/:id/requests/:requestId"
          element={<RequestDetailPage api={api as unknown as RequestDetailApi} />}
        />
        <Route
          path="/users/:id/:tab"
          element={<UserDetailPage api={api as unknown as UserDetailPageApi} />}
        />
        <Route path="/creators/:id" element={<div>creator page</div>} />
        <Route path="/logs/:id" element={<div>log</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

describe('Ringkasan', () => {
  it('shows the board copy for an active user with a pending request', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Raka Putra' })).toBeInTheDocument();
    expect(screen.getByText('@rakaputra · ID 691042285')).toBeInTheDocument();
    expect(screen.getByText('Bergabung 20 Okt 2026')).toBeInTheDocument();
    for (const text of [
      'Profil aplikasi',
      'Nama tampil',
      'Username Telegram',
      'Ringkasan langganan',
      'Langganan aktif',
      'Kedaluwarsa',
      'Terdekat berakhir',
      'Salsa Maheswari, 27 Nov 2026',
      'Status pengajuan creator',
      'Menunggu',
      '13 Nov 2026, 14.20 WIB',
      '1 kali (5 Nov 2026)',
      'Isi percakapan privat tidak ditampilkan di halaman detail user.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Kelola Langganan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detail Pengajuan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block' })).toBeEnabled();
    expect(screen.queryByText('Akun diblokir')).toBeNull();
  });

  it('shows the Blocked variant with the banner and Unblock', async () => {
    setup({ detail: async () => DIMAS });
    expect(await screen.findByText('Akun diblokir')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Diblokir 10 Nov 2026, 10.05 WIB oleh Admin Nadia. Alasan: penyalahgunaan layanan berulang.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Belum mengajukan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Detail Pengajuan' })).toBeNull();
    expect(screen.queryByText('Terdekat berakhir')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeEnabled();
  });

  it('a blocked user without a recorded reason still shows the banner', async () => {
    setup({
      detail: async () => ({
        ...DIMAS,
        block: { reason: null, admin_label: null, at: DIMAS.block!.at },
      }),
    });
    expect(await screen.findByText('Diblokir 10 Nov 2026, 10.05 WIB.')).toBeInTheDocument();
  });

  it('renders user text as text', async () => {
    setup({
      detail: async () => ({
        ...RAKA,
        user: { ...RAKA.user, display_name: '<img src=x onerror=alert(1)>', bio: '<b>x</b>' },
      }),
    });
    expect(
      await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' }),
    ).toBeInTheDocument();
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('tabs and states', () => {
  it('navigates by URL; Langganan shows the access table', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Raka Putra' });
    await userEvent.click(screen.getByRole('tab', { name: 'Langganan' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/users/${USER_ID}/subscriptions`);
    expect(await screen.findByPlaceholderText('Cari creator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Ringkasan' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/users/${USER_ID}`);
  });

  it('Kelola Langganan and Detail Pengajuan go to their targets', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Kelola Langganan' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/users/${USER_ID}/subscriptions`);
    cleanup();
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Detail Pengajuan' }));
    expect(await screen.findByText('Detail pengajuan')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/users/${USER_ID}/requests/${PENDING_REQ}`,
    );
  });

  it('an unknown tab goes back to Ringkasan', async () => {
    setup({ url: `/users/${USER_ID}/nope` });
    await screen.findByRole('heading', { name: 'Raka Putra' });
    expect(screen.getByTestId('where')).not.toHaveTextContent('nope');
  });

  it('a creator id redirects to the creator page', async () => {
    setup({ detail: async () => ({ role: 'CREATOR', creator_id: CREATOR_ID }) });
    expect(await screen.findByText('creator page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}`);
  });

  it('shows not found for a 404 and a generic error with retry', async () => {
    setup({
      detail: async () => {
        throw new ApiError(404, 'NOT_FOUND', 'x');
      },
    });
    expect(await screen.findByText('User tidak ditemukan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke daftar user' })).toHaveAttribute(
      'href',
      '/users',
    );
    cleanup();
    let fail = true;
    const api = setup({
      detail: async () => {
        if (fail) throw new Error('secret');
        return RAKA;
      },
    });
    expect(await screen.findByText('Detail belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByRole('heading', { name: 'Raka Putra' })).toBeInTheDocument();
    expect(api.getUserDetail).toHaveBeenCalledTimes(2);
  });
});

describe('Pengajuan Creator tab', () => {
  it('shows the banner with the blocking reason and the table', async () => {
    const api = setup({ url: `/users/${USER_ID}/requests` });
    expect(await screen.findByText('Pengajuan sedang menunggu')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tidak bisa disetujui sekarang: akun ini punya 1 langganan pelanggan aktif (Salsa Maheswari, hingga 27 Nov 2026).',
      ),
    ).toBeInTheDocument();
    const second = screen.getByText('Pengajuan ke-2').closest('tr') as HTMLElement;
    expect(within(second).getByText('13 Nov 2026, 14.20')).toBeInTheDocument();
    expect(within(second).getByText('Menunggu peninjauan')).toBeInTheDocument();
    const first = screen.getByText('Pengajuan ke-1').closest('tr') as HTMLElement;
    expect(
      within(first).getByText('Ditolak 5 Nov 2026: Link Instagram belum bisa kami verifikasi.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Menampilkan 1–2 dari 2 hasil')).toBeInTheDocument();
    expect(api.listUserRequests).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: 'all' }),
      expect.anything(),
    );
    await userEvent.click(within(first).getByRole('button', { name: /^View/ }));
    expect(await screen.findByText('Detail pengajuan')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/users/${USER_ID}/requests/${REJECTED_REQ}`,
    );
  });

  it('no banner without a pending request; a filter change sends its value and resets the page', async () => {
    const api = setup({
      url: `/users/${USER_ID}/requests?page=2`,
      api: { listUserRequests: vi.fn(async () => ({ ...REQUESTS, pending: null })) },
    });
    await screen.findByText('Pengajuan ke-2');
    expect(screen.queryByText('Pengajuan sedang menunggu')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'rejected');
    await waitFor(() =>
      expect(api.listUserRequests).toHaveBeenLastCalledWith(
        USER_ID,
        expect.objectContaining({ status: 'rejected', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('status=rejected');
  });

  it('shows a generic error with retry', async () => {
    let fail = true;
    setup({
      url: `/users/${USER_ID}/requests`,
      api: {
        listUserRequests: vi.fn(async () => {
          if (fail) throw new Error('secret');
          return REQUESTS;
        }),
      },
    });
    const retry = await screen.findByRole('button', { name: /Coba Lagi|Retry/i });
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Pengajuan ke-2')).toBeInTheDocument();
  });
});

describe('History tab', () => {
  it("loads this user's history with a back state", async () => {
    const api = setup({ url: `/users/${USER_ID}/history` });
    expect(await screen.findByText('Setujui creator')).toBeInTheDocument();
    expect(api.listUserHistory).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: 'all' }),
      expect.anything(),
    );
    await userEvent.click(
      within(screen.getByText('Login diblokir').closest('tr') as HTMLElement).getByRole('button', {
        name: /^View/,
      }),
    );
    expect(await screen.findByText('log')).toBeInTheDocument();
  });
});

describe('block and unblock from the header', () => {
  it('block: dialog with reason, then the refetched Blocked header and a toast', async () => {
    let current = RAKA;
    const api = setup({
      detail: async () => current,
      api: {
        blockUser: vi.fn(async (id: string) => {
          current = { ...DIMAS, user: { ...DIMAS.user, id: USER_ID } };
          return { user: { id, status: 'BLOCKED' as const } };
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Raka Putra' });
    await userEvent.click(screen.getByRole('button', { name: 'Block' }));
    await userEvent.type(await screen.findByRole('textbox'), 'penyalahgunaan');
    await userEvent.click(screen.getAllByRole('button', { name: /^Block/ }).at(-1)!);
    expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    expect(api.blockUser).toHaveBeenCalledWith(USER_ID, 'penyalahgunaan');
  });
});

describe('request detail', () => {
  it('pending with a blocking subscription: approve disabled, reject sends the reason and refetches', async () => {
    const api = setup({ url: `/users/${USER_ID}/requests/${PENDING_REQ}` });
    expect(await screen.findByText('Detail pengajuan')).toBeInTheDocument();
    for (const text of [
      'Nama creator',
      '@raka.kitchen',
      'Creator Asli',
      'Dikonfirmasi',
      'Status peninjauan',
      'Menunggu',
      '13 Nov 2026, 14.20 WIB',
      '1 langganan aktif',
      /Tidak bisa disetujui sampai seluruh langganan/,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Setujui' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Tolak' }));
    await userEvent.type(await screen.findByRole('textbox'), '  Tidak sesuai ');
    await userEvent.click(screen.getByRole('button', { name: 'Tolak Permintaan' }));
    await waitFor(() =>
      expect(api.rejectCreatorRequest).toHaveBeenCalledWith(PENDING_REQ, 'Tidak sesuai'),
    );
    expect(await screen.findByText(/ditolak dan dicatat/)).toBeInTheDocument();
    await waitFor(() => expect(api.getUserRequest?.mock.calls.length ?? 0).toBeGreaterThan(1));
  });

  it('approve (no block): one call, navigates to the creator, banner shown', async () => {
    const api = setup({
      url: `/users/${USER_ID}/requests/${PENDING_REQ}`,
      api: { getUserRequest: vi.fn(async () => ({ ...PENDING_DETAIL, check: { block: null } })) },
    });
    await screen.findByText('Detail pengajuan');
    expect(screen.getByText('Tidak ada')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Setujui Creator' }));
    await waitFor(() => expect(api.approveCreatorRequest).toHaveBeenCalledTimes(1));
    expect(api.approveCreatorRequest).toHaveBeenCalledWith(PENDING_REQ);
    expect(await screen.findByText('creator page')).toBeInTheDocument();
  });

  it('rejected: result card, reviewer, reason and Lihat di Log', async () => {
    setup({ url: `/users/${USER_ID}/requests/${REJECTED_REQ}` });
    expect(await screen.findByText('Hasil peninjauan')).toBeInTheDocument();
    for (const text of [
      'Ditolak',
      'Ditinjau oleh',
      'Admin Nadia',
      '5 Nov 2026, 14.12 WIB',
      /Link Instagram belum bisa kami verifikasi\. Pastikan/,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Setujui' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lihat di Log' }));
    expect(await screen.findByText('log')).toBeInTheDocument();
  });

  it('hides Lihat di Log without a log id; 404 shows not found; text rendered as text', async () => {
    setup({
      url: `/users/${USER_ID}/requests/${REJECTED_REQ}`,
      api: {
        getUserRequest: vi.fn(async () => ({
          ...REJECTED_DETAIL,
          review: {
            ...REJECTED_DETAIL.review!,
            log_id: null,
            reason: '<img src=x onerror=alert(1)>',
          },
        })),
      },
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lihat di Log' })).toBeNull();
    cleanup();
    setup({
      url: `/users/${USER_ID}/requests/${PENDING_REQ}`,
      api: {
        getUserRequest: vi.fn(async () => {
          throw new ApiError(404, 'NOT_FOUND', 'x');
        }),
      },
    });
    expect(await screen.findByText('Pengajuan tidak ditemukan')).toBeInTheDocument();
  });
});
