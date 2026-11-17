import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorDetail } from '@creatorchat/contracts';
import { ApiError } from '../../auth/api-client';
import { LUNA, MAYA } from '../../preview/review-fixtures';
import {
  ACTIVE_DETAIL,
  BLOCKED_DETAIL,
  CREATOR_ID,
  HISTORY_ROWS,
  REQUEST_DETAIL,
  REQ_ID,
} from '../../../test/creator-detail-fixtures';
import { CreatorDetailPage, type CreatorDetailPageApi } from './CreatorDetailPage';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function setup(
  options: {
    detail?: (id: string) => Promise<{ detail: CreatorDetail; checked_at: string }>;
    url?: string;
    api?: Partial<CreatorDetailPageApi>;
  } = {},
) {
  const getCreatorDetail = vi.fn(
    options.detail ??
      (async (id: string) => ({
        detail: id === CREATOR_ID ? ACTIVE_DETAIL : REQUEST_DETAIL,
        checked_at: '2026-11-16T08:00:00.000Z',
      })),
  );
  const api = {
    getCreatorDetail,
    listCreatorHistory: vi.fn(async () => ({
      items: HISTORY_ROWS,
      total: 4,
      page: 1,
      page_size: 10 as const,
    })),
    getAuditLog: vi.fn(),
    getCreatorRequest: vi.fn(async () => ({
      request: MAYA,
      check: { block: null, checked_at: '2026-11-16T08:00:00.000Z' },
    })),
    approveCreatorRequest: vi.fn(async (id: string) => ({
      request: {
        ...MAYA,
        id,
        status: 'APPROVED' as const,
        reviewed_at: '2026-11-16T08:00:00.000Z',
      },
      creator: { id: CREATOR_ID, public_code: 'k4m5x2qa' },
    })),
    rejectCreatorRequest: vi.fn(async (id: string, reason: string) => ({
      request: {
        ...LUNA,
        id,
        status: 'REJECTED' as const,
        reviewed_at: '2026-11-16T08:00:00.000Z',
        review_reason: reason,
      },
    })),
    getBlockCheck: vi.fn(async () => ({
      creator_status: 'ACTIVE' as const,
      active_subscribers: 58,
      checked_at: '2026-11-16T08:00:00.000Z',
    })),
    blockCreator: vi.fn(async (id: string) => ({
      creator: { id, status: 'BLOCKED' as const },
      active_subscribers: 58,
    })),
    unblockCreator: vi.fn(async (id: string) => ({ creator: { id, status: 'ACTIVE' as const } })),
    ...options.api,
  } as unknown as CreatorDetailPageApi;
  render(
    <MemoryRouter initialEntries={[options.url ?? `/creators/${REQ_ID}`]}>
      <Routes>
        <Route path="/creators" element={<div>list</div>} />
        <Route path="/creators/:id" element={<CreatorDetailPage api={api} />} />
        <Route path="/creators/:id/:tab" element={<CreatorDetailPage api={api} />} />
        <Route path="/logs/:id" element={<div>log</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { api: api as unknown as Record<string, ReturnType<typeof vi.fn>>, getCreatorDetail };
}

describe('Ringkasan: request', () => {
  it('shows the board copy and the empty subscription check', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Maya Lestari' })).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('@mayalestari · ID 582917403')).toBeInTheDocument();
    expect(screen.getByText('@maya.lestari', { selector: 'span *, span' })).toBeInTheDocument();
    expect(screen.getByText('Diajukan 14 Nov 2026, 14.58 WIB')).toBeInTheDocument();
    for (const text of [
      'Deskripsi pengajuan',
      'Nama creator',
      'Pernyataan hak',
      'Dikonfirmasi: berhak mengelola identitas dan konten.',
      'Pemeriksaan sebelum menyetujui',
      'Tidak ada',
      'USER',
      'Pertama kali',
      /Pemeriksaan diulang saat Setujui ditekan/,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Setujui' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tolak' })).toBeEnabled();
    expect(screen.queryByText('Kategori')).toBeNull();
    expect(screen.queryByText('Kota')).toBeNull();
  });

  it('shows the blocking subscription and earlier rejections', async () => {
    const detail: CreatorDetail = {
      ...REQUEST_DETAIL,
      request: {
        ...REQUEST_DETAIL.request!,
        previous_rejections: 2,
        subscription_block: {
          count: 1,
          creator_name: 'Salsa Maheswari',
          ends_at: '2026-11-27T08:00:00.000Z',
        },
      },
    };
    setup({ detail: async () => ({ detail, checked_at: 'x' }) });
    expect(await screen.findByText('1 aktif')).toBeInTheDocument();
    expect(screen.getByText('Salsa Maheswari, hingga 27 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('Ditolak 2 kali sebelumnya')).toBeInTheDocument();
    expect(screen.queryByText('Tidak ada')).toBeNull();
  });

  it('renders applicant text as text', async () => {
    const detail: CreatorDetail = {
      ...REQUEST_DETAIL,
      creator_name: '<img src=x onerror=alert(1)>',
    };
    setup({ detail: async () => ({ detail, checked_at: 'x' }) });
    expect(
      await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' }),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('Ringkasan: creator', () => {
  it('shows Active with stat cards and "–" for data that does not exist yet', async () => {
    setup({ url: `/creators/${CREATOR_ID}` });
    expect(await screen.findByRole('heading', { name: 'Salsa Maheswari' })).toBeInTheDocument();
    expect(screen.getByText('Aktif sejak 21 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getAllByText('–').length).toBe(7);
    expect(screen.getByText('Bio dan deskripsi pengajuan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lihat Usage' })).toBeDisabled();
    expect(screen.queryByText('Kategori')).toBeNull();
  });

  it('shows Blocked with the block time and Unblock', async () => {
    setup({
      url: `/creators/${CREATOR_ID}`,
      detail: async () => ({ detail: BLOCKED_DETAIL, checked_at: 'x' }),
    });
    expect(await screen.findByText('Diblokir 13 Nov 2026, 11.20 WIB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });
});

describe('tabs and states', () => {
  it('navigates by URL and shows the placeholder for later tabs', async () => {
    setup({ url: `/creators/${CREATOR_ID}` });
    await screen.findByRole('heading', { name: 'Salsa Maheswari' });
    await userEvent.click(screen.getByRole('tab', { name: 'Persona AI' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}/persona`);
    expect(screen.getByTestId('not-implemented')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Ringkasan' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}`);
  });

  it('an unknown tab goes back to Ringkasan', async () => {
    setup({ url: `/creators/${CREATOR_ID}/nope` });
    await screen.findByRole('heading', { name: 'Salsa Maheswari' });
    expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}`);
    expect(screen.getByTestId('where')).not.toHaveTextContent('nope');
  });

  it('shows not found for a 404', async () => {
    setup({
      detail: async () => {
        throw new ApiError(404, 'NOT_FOUND', 'x');
      },
    });
    expect(await screen.findByText('Creator tidak ditemukan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke daftar creator' })).toHaveAttribute(
      'href',
      '/creators',
    );
  });

  it('shows a generic error and retries', async () => {
    let fail = true;
    const { getCreatorDetail } = setup({
      detail: async () => {
        if (fail) throw new Error('secret detail');
        return { detail: REQUEST_DETAIL, checked_at: 'x' };
      },
    });
    expect(await screen.findByText('Detail belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret detail/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByRole('heading', { name: 'Maya Lestari' })).toBeInTheDocument();
    expect(getCreatorDetail).toHaveBeenCalledTimes(2);
  });

  it('replaces the URL when the server resolves the id to another one', async () => {
    setup({ detail: async () => ({ detail: ACTIVE_DETAIL, checked_at: 'x' }) });
    expect(await screen.findByRole('heading', { name: 'Salsa Maheswari' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}`),
    );
  });
});

describe('History tab', () => {
  it('loads this person history and links View to the log with a back state', async () => {
    const { api } = setup({ url: `/creators/${CREATOR_ID}/history?type=access` });
    expect(await screen.findByText('Setujui creator')).toBeInTheDocument();
    expect(api.listCreatorHistory).toHaveBeenCalledWith(
      CREATOR_ID,
      expect.objectContaining({ type: 'access' }),
      expect.anything(),
    );
    const row = screen.getByText('Login diblokir').closest('tr') as HTMLElement;
    expect(within(row).getByText('Gagal')).toBeInTheDocument();
    expect(within(row).getByText('12 Sep 2026, 09.30')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /^View/ }));
    expect(await screen.findByText('log')).toBeInTheDocument();
  });

  it('a filter change sends the value, resets the page and keeps it in the URL', async () => {
    const { api } = setup({ url: `/creators/${CREATOR_ID}/history?page=2` });
    await screen.findByText('Setujui creator');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed');
    await waitFor(() =>
      expect(api.listCreatorHistory).toHaveBeenLastCalledWith(
        CREATOR_ID,
        expect.objectContaining({ status: 'failed', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('status=failed');
  });
});

describe('decisions from the header', () => {
  it('approve: one call with the application id, URL becomes the creator id, banner shown', async () => {
    const { api, getCreatorDetail } = setup();
    await screen.findByRole('heading', { name: 'Maya Lestari' });
    await userEvent.click(screen.getByRole('button', { name: 'Setujui' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Setujui Creator' }));
    await waitFor(() => expect(api.approveCreatorRequest).toHaveBeenCalledTimes(1));
    expect(api.approveCreatorRequest).toHaveBeenCalledWith(REQ_ID);
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/creators/${CREATOR_ID}`),
    );
    expect(await screen.findByText('Maya Lestari kini Creator Active')).toBeInTheDocument();
    await waitFor(() =>
      expect(getCreatorDetail).toHaveBeenCalledWith(CREATOR_ID, expect.anything()),
    );
  });

  it('reject: reason sent, toast, back to the list', async () => {
    const { api } = setup();
    await screen.findByRole('heading', { name: 'Maya Lestari' });
    await userEvent.click(screen.getByRole('button', { name: 'Tolak' }));
    await userEvent.type(await screen.findByRole('textbox'), '  Tidak sesuai  ');
    await userEvent.click(screen.getByRole('button', { name: 'Tolak Permintaan' }));
    await waitFor(() =>
      expect(api.rejectCreatorRequest).toHaveBeenCalledWith(REQ_ID, 'Tidak sesuai'),
    );
    expect(await screen.findByText('list')).toBeInTheDocument();
  });

  it('block: dialog with reason, then the Blocked header after the refetch and a toast', async () => {
    let status: CreatorDetail = ACTIVE_DETAIL;
    const { api } = setup({
      url: `/creators/${CREATOR_ID}`,
      detail: async () => ({ detail: status, checked_at: 'x' }),
      api: {
        blockCreator: vi.fn(async (id: string) => {
          status = { ...BLOCKED_DETAIL, id: CREATOR_ID };
          return { creator: { id, status: 'BLOCKED' as const }, active_subscribers: 58 };
        }),
      } as never,
    });
    await screen.findByRole('heading', { name: 'Salsa Maheswari' });
    await userEvent.click(screen.getByRole('button', { name: 'Block' }));
    await userEvent.type(await screen.findByRole('textbox'), 'Pelanggaran');
    await userEvent.click(screen.getAllByRole('button', { name: /^Block/ }).at(-1)!);
    expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
    expect(api.blockCreator).toHaveBeenCalledWith(CREATOR_ID, 'Pelanggaran');
    expect(
      screen.getByText(/diblokir/i, { selector: '[role=status] *, [role=status]' }),
    ).toBeInTheDocument();
  });
});

describe('Subscriber tab (US-021)', () => {
  it('a creator shows the subscribers table and reloads the detail after a change', async () => {
    const listCreatorSubscribers = vi.fn(async () => ({
      items: [
        {
          id: '5b000000-0000-4000-8000-000000000201',
          customer: {
            id: '10000000-0000-4000-8000-000000000101',
            display_name: 'Raka Putra',
            avatar_url: null,
            telegram_username: 'rakaputra',
            telegram_id: '691042285',
          },
          status: 'ACTIVE' as const,
          starts_at: '2026-10-28T03:00:00.000Z',
          ends_at: '2026-11-27T16:59:59.000Z',
          revoked_at: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 10 as const,
    }));
    const extendAccess = vi.fn(async () => ({
      subscription: {
        id: '5b000000-0000-4000-8000-000000000201',
        creator_id: CREATOR_ID,
        status: 'ACTIVE' as const,
        starts_at: 'x',
        ends_at: '2026-12-31T16:59:59.000Z',
        revoked_at: null,
      },
    }));
    const { api, getCreatorDetail } = setup({
      url: `/creators/${CREATOR_ID}/subscribers`,
      api: {
        listCreatorSubscribers,
        extendAccess,
        getGrantableCreators: vi.fn(),
        listGrantableUsers: vi.fn(),
      },
    });
    expect(await screen.findByText('Raka Putra')).toBeInTheDocument();
    expect(listCreatorSubscribers).toHaveBeenCalledWith(
      CREATOR_ID,
      expect.objectContaining({ status: 'all' }),
      expect.anything(),
    );
    const before = getCreatorDetail.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^Perpanjang/ }));
    await userEvent.type(await screen.findByRole('textbox'), 'Tambah');
    await userEvent.click(screen.getByRole('button', { name: 'Perpanjang Akses' }));
    await waitFor(() =>
      expect(extendAccess).toHaveBeenCalledWith(
        '10000000-0000-4000-8000-000000000101',
        '5b000000-0000-4000-8000-000000000201',
        { duration_days: 30, reason: 'Tambah' },
      ),
    );
    await waitFor(() => expect(getCreatorDetail.mock.calls.length).toBeGreaterThan(before));
    void api;
  });

  it('a pending request shows the empty message and never calls the API', async () => {
    const listCreatorSubscribers = vi.fn();
    setup({ url: `/creators/${REQ_ID}/subscribers`, api: { listCreatorSubscribers } });
    expect(await screen.findByText(/Belum ada subscriber/)).toBeInTheDocument();
    expect(listCreatorSubscribers).not.toHaveBeenCalled();
  });
});
