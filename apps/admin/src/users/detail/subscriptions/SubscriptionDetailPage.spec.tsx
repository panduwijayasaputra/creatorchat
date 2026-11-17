import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SubscriptionDetailResponse,
  SubscriptionEventsResponse,
} from '@creatorchat/contracts';
import { ApiError } from '../../../auth/api-client';
import {
  ACTIVE_SUB,
  EVENTS,
  EXPIRED_SUB,
  LOG_ID,
  REVOKED_SUB,
  SUB_ID,
  USER_ID,
} from '../../../../test/subscription-fixtures';
import { SubscriptionDetailPage, type SubscriptionDetailPageApi } from './SubscriptionDetailPage';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  return (
    <>
      <div data-testid="where">{l.pathname + l.search}</div>
      <div data-testid="from">{(l.state as { from?: string } | null)?.from}</div>
    </>
  );
}

const ACTION = {
  subscription: {
    id: SUB_ID,
    creator_id: ACTIVE_SUB.creator.id,
    status: 'ACTIVE' as const,
    starts_at: ACTIVE_SUB.subscription.starts_at,
    ends_at: '2026-12-31T16:59:59.000Z',
    revoked_at: null,
  },
};

function setup(
  options: {
    detail?: () => Promise<SubscriptionDetailResponse>;
    events?: () => Promise<SubscriptionEventsResponse>;
    url?: string;
    state?: unknown;
    api?: Record<string, unknown>;
  } = {},
) {
  const api = {
    getSubscription: vi.fn(options.detail ?? (async () => ACTIVE_SUB)),
    listSubscriptionEvents: vi.fn(options.events ?? (async () => EVENTS)),
    extendAccess: vi.fn(async () => ACTION),
    revokeAccess: vi.fn(async () => ({
      subscription: { ...ACTION.subscription, status: 'REVOKED' as const },
    })),
    grantAccess: vi.fn(async () => ACTION),
    getGrantableCreators: vi.fn(async () => ({ items: [] })),
    listUserSubscriptions: vi.fn(),
    ...options.api,
  };
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: options.url ?? `/users/${USER_ID}/subscriptions/${SUB_ID}`,
          state: options.state,
        },
      ]}
    >
      <Routes>
        <Route
          path="/users/:id/subscriptions/:subId"
          element={<SubscriptionDetailPage api={api as unknown as SubscriptionDetailPageApi} />}
        />
        <Route path="/users/:id/subscriptions" element={<div>list</div>} />
        <Route path="/logs/:id" element={<div>log</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

describe('content', () => {
  it('shows the board copy for an active subscription and its history', async () => {
    const api = setup();
    expect(await screen.findByText('Langganan: Raka Putra → Salsa Maheswari')).toBeInTheDocument();
    for (const text of [
      'Active',
      '28 Okt 2026',
      '27 Nov 2026, 23.59 WIB',
      'Diberikan admin',
      'Admin Nadia',
      'Tidak ada transaksi',
      'Riwayat akses',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: 'Perpanjang' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cabut Akses' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Berikan Ulang' })).toBeNull();
    const row = (await screen.findByText('Berikan akses')).closest('tr') as HTMLElement;
    expect(within(row).getByText('28 Okt 2026, 10.20')).toBeInTheDocument();
    expect(within(row).getByText('30 hari')).toBeInTheDocument();
    expect(within(row).getByText('Berhasil')).toBeInTheDocument();
    expect(await screen.findByText('Menampilkan 1–1 dari 1 hasil')).toBeInTheDocument();
    expect(api.listSubscriptionEvents).toHaveBeenCalledWith(
      USER_ID,
      SUB_ID,
      expect.objectContaining({ sort: 'time', dir: 'desc' }),
      expect.anything(),
    );
  });

  it.each([
    ['expired', EXPIRED_SUB, 'Kedaluwarsa'],
    ['revoked', REVOKED_SUB, 'Dicabut'],
  ])('%s shows Berikan Ulang and no Perpanjang / Cabut', async (_name, detail, chip) => {
    setup({ detail: async () => detail });
    expect(await screen.findByRole('button', { name: 'Berikan Ulang' })).toBeEnabled();
    expect(screen.getByText(chip)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Perpanjang' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cabut Akses' })).toBeNull();
  });

  it('a subscription without a recorded grant shows a dash; names render as text', async () => {
    setup({
      detail: async () => ({
        ...ACTIVE_SUB,
        subscription: { ...ACTIVE_SUB.subscription, created_by_label: null },
        creator: { ...ACTIVE_SUB.creator, display_name: '<img src=x onerror=alert(1)>' },
      }),
    });
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('–')).toBeInTheDocument();
  });
});

describe('history table', () => {
  it('sorting and paging change the request and the URL', async () => {
    const api = setup();
    await screen.findByText('Berikan akses');
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Aktor/ }).querySelector('button')!,
    );
    await waitFor(() =>
      expect(api.listSubscriptionEvents).toHaveBeenLastCalledWith(
        USER_ID,
        SUB_ID,
        expect.objectContaining({ sort: 'actor', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('sort=actor');
  });

  it('View opens the log with a back state; disabled without a log id', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /^View Berikan akses/ }));
    expect(await screen.findByText('log')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/logs/${LOG_ID}`);
    cleanup();
    setup({ events: async () => ({ ...EVENTS, items: [{ ...EVENTS.items[0]!, log_id: null }] }) });
    expect(await screen.findByRole('button', { name: /^View Berikan akses/ })).toBeDisabled();
  });

  it('shows the error state with retry for the history only', async () => {
    let fail = true;
    const api = setup({
      events: async () => {
        if (fail) throw new Error('secret');
        return EVENTS;
      },
    });
    const retry = await screen.findByRole('button', { name: /Coba Lagi|Retry/i });
    expect(screen.getByText('Langganan: Raka Putra → Salsa Maheswari')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Berikan akses')).toBeInTheDocument();
    expect(api.listSubscriptionEvents).toHaveBeenCalledTimes(2);
  });
});

describe('actions', () => {
  it('Perpanjang sends the extend call for this subscription, refetches and shows the toast', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Perpanjang' }));
    await userEvent.type(await screen.findByRole('textbox'), 'Tambah waktu');
    await userEvent.click(screen.getByRole('button', { name: 'Perpanjang Akses' }));
    await waitFor(() => expect(api.extendAccess).toHaveBeenCalledTimes(1));
    expect(api.extendAccess).toHaveBeenCalledWith(USER_ID, SUB_ID, {
      duration_days: 30,
      reason: 'Tambah waktu',
    });
    expect(await screen.findByText(/diperpanjang hingga/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSubscription?.mock.calls.length ?? 0).toBeGreaterThan(1));
    expect(api.listSubscriptionEvents?.mock.calls.length ?? 0).toBeGreaterThan(1);
  });

  it('Cabut Akses sends the revoke call', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Cabut Akses' }));
    await userEvent.type(await screen.findByRole('textbox'), 'Pelanggaran');
    await userEvent.click(screen.getAllByRole('button', { name: /Cabut Akses/ }).at(-1)!);
    await waitFor(() =>
      expect(api.revokeAccess).toHaveBeenCalledWith(USER_ID, SUB_ID, 'Pelanggaran'),
    );
    expect(await screen.findByText(/dicabut/)).toBeInTheDocument();
  });

  it('a 409 closes with the conflict toast and refetches', async () => {
    const api = setup({
      api: {
        extendAccess: vi.fn(async () => {
          throw new ApiError(409, 'SUBSCRIPTION_REVOKED', 'x');
        }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Perpanjang' }));
    await userEvent.type(await screen.findByRole('textbox'), 'Coba');
    await userEvent.click(screen.getByRole('button', { name: 'Perpanjang Akses' }));
    expect(await screen.findByText(/sudah berubah/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSubscription?.mock.calls.length ?? 0).toBeGreaterThan(1));
  });
});

describe('navigation and states', () => {
  it('Kembali ke Langganan returns to the list URL it came from', async () => {
    setup({ state: { from: `/users/${USER_ID}/subscriptions?status=active&page=2` } });
    const link = await screen.findByRole('link', { name: 'Kembali ke Langganan' });
    expect(link).toHaveAttribute('href', `/users/${USER_ID}/subscriptions?status=active&page=2`);
  });

  it('falls back to the plain Langganan tab', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'Kembali ke Langganan' })).toHaveAttribute(
      'href',
      `/users/${USER_ID}/subscriptions`,
    );
  });

  it('shows not found for a 404 and a generic error with retry', async () => {
    setup({
      detail: async () => {
        throw new ApiError(404, 'NOT_FOUND', 'x');
      },
    });
    expect(await screen.findByText('Langganan tidak ditemukan')).toBeInTheDocument();
    cleanup();
    let fail = true;
    const api = setup({
      detail: async () => {
        if (fail) throw new Error('secret');
        return ACTIVE_SUB;
      },
    });
    expect(await screen.findByText('Detail belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Langganan: Raka Putra → Salsa Maheswari')).toBeInTheDocument();
    expect(api.getSubscription).toHaveBeenCalledTimes(2);
  });
});
