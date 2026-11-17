import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorSubscribersResponse } from '@creatorchat/contracts';
import { ToastProvider } from '@creatorchat/ui';
import { ApiError } from '../../../auth/api-client';
import { CREATOR_ID, SUBSCRIBERS, SUBSCRIBER_ROWS } from '../../../../test/subscription-fixtures';
import { SubscribersTab, type SubscribersTabApi } from './SubscribersTab';

afterEach(cleanup);

const CREATOR = { id: CREATOR_ID, display_name: 'Salsa Maheswari' };
const RAKA = SUBSCRIBER_ROWS[0]!;
const NADIA = SUBSCRIBER_ROWS[3]!; // expired
const ACTION = (id = RAKA.id) => ({
  subscription: {
    id,
    creator_id: CREATOR_ID,
    status: 'ACTIVE' as const,
    starts_at: RAKA.starts_at,
    ends_at: '2026-12-31T16:59:59.000Z',
    revoked_at: null,
  },
});

function Where() {
  const l = useLocation();
  return (
    <>
      <div data-testid="where">{l.pathname + l.search}</div>
      <div data-testid="from">{(l.state as { from?: string } | null)?.from}</div>
    </>
  );
}

function setup(
  options: {
    list?: (q: unknown) => Promise<CreatorSubscribersResponse>;
    blocked?: boolean;
    url?: string;
    api?: Record<string, unknown>;
  } = {},
) {
  const onChanged = vi.fn();
  const api = {
    listCreatorSubscribers: vi.fn(options.list ?? (async () => SUBSCRIBERS)),
    listGrantableUsers: vi.fn(async () => ({
      creator_status: 'ACTIVE' as const,
      items: [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          display_name: 'Maya Lestari',
          avatar_url: null,
          telegram_username: 'mayalestari',
          telegram_id: '582917403',
        },
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          display_name: 'Luna Aurora',
          avatar_url: null,
          telegram_username: null,
          telegram_id: '774120936',
        },
      ],
    })),
    extendAccess: vi.fn(async (_u: string, id: string) => ACTION(id)),
    revokeAccess: vi.fn(async (_u: string, id: string) => ({
      subscription: { ...ACTION(id).subscription, status: 'REVOKED' as const },
    })),
    grantAccess: vi.fn(async () => ACTION('b0000000-0000-4000-8000-000000000001')),
    getGrantableCreators: vi.fn(async () => ({ items: [] })),
    listUserSubscriptions: vi.fn(),
    ...options.api,
  };
  render(
    <MemoryRouter initialEntries={[options.url ?? '/creators/x/subscribers']}>
      <ToastProvider>
        <Routes>
          <Route
            path="/creators/:id/subscribers"
            element={
              <SubscribersTab
                api={api as unknown as SubscribersTabApi}
                creator={CREATOR}
                creatorBlocked={options.blocked ?? false}
                onChanged={onChanged}
              />
            }
          />
          <Route path="/users/:id" element={<div>user page</div>} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { api: api as unknown as Record<string, ReturnType<typeof vi.fn>>, onChanged };
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('table', () => {
  it('shows the board columns, rows and the actions that fit each status', async () => {
    setup();
    await screen.findByText('Raka Putra');
    for (const h of ['Subscriber', 'Telegram', 'Status akses', 'Mulai', 'Berakhir', 'Aksi']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeInTheDocument();
    }
    expect(await screen.findByText('Menampilkan 1–10 dari 58 hasil')).toBeInTheDocument();
    const raka = rowOf('Raka Putra');
    expect(within(raka).getByText('@rakaputra')).toBeInTheDocument();
    expect(within(raka).getByText('ID 691042285')).toBeInTheDocument();
    expect(within(raka).getByText('Active')).toBeInTheDocument();
    expect(within(raka).getByText('28 Okt 2026')).toBeInTheDocument();
    expect(within(raka).getByText('27 Nov 2026')).toBeInTheDocument();
    expect(within(raka).getByRole('button', { name: /^Perpanjang/ })).toBeEnabled();
    expect(within(raka).getByRole('button', { name: /^Cabut/ })).toBeEnabled();
    const nadia = rowOf('Nadia Kusuma');
    expect(within(nadia).getByText('Kedaluwarsa')).toBeInTheDocument();
    expect(within(nadia).getByRole('button', { name: /^Berikan ulang/ })).toBeEnabled();
    expect(within(nadia).queryByRole('button', { name: /^Perpanjang/ })).toBeNull();
  });

  it('View opens the user detail and remembers where it came from', async () => {
    setup({ url: '/creators/x/subscribers?status=active' });
    await userEvent.click(
      within(
        await screen.findByText('Raka Putra').then((e) => e.closest('tr') as HTMLElement),
      ).getByRole('button', { name: /^View/ }),
    );
    expect(await screen.findByText('user page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/users/${RAKA.customer.id}`);
    expect(screen.getByTestId('from')).toHaveTextContent('/creators/x/subscribers?status=active');
  });

  it('search, filters, sort and size send their values, reset the page and live in the URL', async () => {
    const { api } = setup({ url: '/creators/x/subscribers?page=2' });
    await screen.findByText('Raka Putra');
    await userEvent.selectOptions(screen.getByLabelText('Status akses'), 'expired');
    await waitFor(() =>
      expect(api.listCreatorSubscribers).toHaveBeenLastCalledWith(
        CREATOR_ID,
        expect.objectContaining({ status: 'expired', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('status=expired');
    await userEvent.selectOptions(screen.getByLabelText('Berakhir'), 'past');
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Subscriber/ }).querySelector('button')!,
    );
    await waitFor(() =>
      expect(api.listCreatorSubscribers).toHaveBeenLastCalledWith(
        CREATOR_ID,
        expect.objectContaining({ sort: 'subscriber', ends: 'past' }),
        expect.anything(),
      ),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Filter' })[0]!);
    await waitFor(() =>
      expect(api.listCreatorSubscribers).toHaveBeenLastCalledWith(
        CREATOR_ID,
        expect.objectContaining({ q: null, status: 'all', ends: 'all' }),
        expect.anything(),
      ),
    );
  });

  it('shows empty, no-results and error states; error text stays generic', async () => {
    setup({ list: async () => ({ ...SUBSCRIBERS, items: [], total: 0 }) });
    expect(await screen.findByText('Belum ada data')).toBeInTheDocument();
    cleanup();
    setup({
      list: async () => ({ ...SUBSCRIBERS, items: [], total: 0 }),
      url: '/creators/x/subscribers?q=zzz',
    });
    expect(await screen.findByText('Tidak ada hasil')).toBeInTheDocument();
    cleanup();
    let fail = true;
    setup({
      list: async () => {
        if (fail) throw new Error('secret');
        return SUBSCRIBERS;
      },
    });
    const retry = await screen.findByRole('button', { name: /Coba Lagi|Retry/i });
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Raka Putra')).toBeInTheDocument();
  });

  it('renders names as text', async () => {
    setup({
      list: async () => ({
        ...SUBSCRIBERS,
        items: [
          { ...RAKA, customer: { ...RAKA.customer, display_name: '<img src=x onerror=alert(1)>' } },
        ],
      }),
    });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('row actions use the customer and subscription of the row', () => {
  it('Perpanjang', async () => {
    const { api, onChanged } = setup();
    await userEvent.click(
      within(
        await screen.findByText('Raka Putra').then((e) => e.closest('tr') as HTMLElement),
      ).getByRole('button', { name: /^Perpanjang/ }),
    );
    await userEvent.type(await screen.findByRole('textbox'), 'Tambah waktu');
    await userEvent.click(screen.getByRole('button', { name: 'Perpanjang Akses' }));
    await waitFor(() => expect(api.extendAccess).toHaveBeenCalledTimes(1));
    expect(api.extendAccess).toHaveBeenCalledWith(RAKA.customer.id, RAKA.id, {
      duration_days: 30,
      reason: 'Tambah waktu',
    });
    expect(await screen.findByText(/diperpanjang hingga/)).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(api.listCreatorSubscribers?.mock.calls.length ?? 0).toBeGreaterThan(1),
    );
  });

  it('Cabut', async () => {
    const { api } = setup();
    await userEvent.click(
      within(
        await screen.findByText('Raka Putra').then((e) => e.closest('tr') as HTMLElement),
      ).getByRole('button', { name: /^Cabut/ }),
    );
    await userEvent.type(await screen.findByRole('textbox'), 'Pelanggaran');
    await userEvent.click(screen.getAllByRole('button', { name: /Cabut Akses/ }).at(-1)!);
    await waitFor(() =>
      expect(api.revokeAccess).toHaveBeenCalledWith(RAKA.customer.id, RAKA.id, 'Pelanggaran'),
    );
  });

  it('Berikan Ulang grants to the same user for this creator; a 409 refetches with the conflict toast', async () => {
    const { api, onChanged } = setup({
      api: {
        grantAccess: vi.fn(async () => {
          throw new ApiError(409, 'SUBSCRIPTION_ACTIVE', 'x');
        }),
      },
    });
    await userEvent.click(
      within(
        await screen.findByText('Nadia Kusuma').then((e) => e.closest('tr') as HTMLElement),
      ).getByRole('button', { name: /^Berikan ulang/ }),
    );
    await userEvent.type(await screen.findByRole('textbox'), 'Perpanjang lagi');
    await userEvent.click(screen.getAllByRole('button', { name: 'Berikan Akses' }).at(-1)!);
    await waitFor(() =>
      expect(api.grantAccess).toHaveBeenCalledWith(
        NADIA.customer.id,
        expect.objectContaining({
          creator_id: CREATOR_ID,
          duration_days: 30,
          reason: 'Perpanjang lagi',
        }),
      ),
    );
    expect(await screen.findByText(/sudah berubah/)).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('Berikan Akses with the user picker', () => {
  it('searches on the server, needs a user and a reason, then grants to the picked user', async () => {
    const { api, onChanged } = setup();
    await screen.findByText('Raka Putra');
    await userEvent.click(screen.getByRole('button', { name: 'Berikan Akses' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Maya Lestari')).toBeInTheDocument();
    expect(api.listGrantableUsers).toHaveBeenCalledWith(CREATOR_ID, null, expect.anything());
    const confirm = within(dialog).getAllByRole('button', { name: 'Berikan Akses' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Cari nama atau Telegram ID'), 'maya');
    await waitFor(() =>
      expect(api.listGrantableUsers).toHaveBeenLastCalledWith(
        CREATOR_ID,
        'maya',
        expect.anything(),
      ),
    );
    await userEvent.click(await within(dialog).findByRole('option', { name: /Maya Lestari/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Alasan/ }), 'Uji coba');
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Berikan Akses' }).at(-1)!);
    await waitFor(() => expect(api.grantAccess).toHaveBeenCalledTimes(1));
    expect(api.grantAccess).toHaveBeenCalledWith(
      'a0000000-0000-4000-8000-000000000001',
      expect.objectContaining({ creator_id: CREATOR_ID, duration_days: 30, reason: 'Uji coba' }),
    );
    expect(
      await screen.findByText(/Akses Maya Lestari ke Salsa Maheswari diberikan hingga/),
    ).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('shows the empty and the failed picker states', async () => {
    setup({
      api: { listGrantableUsers: vi.fn(async () => ({ creator_status: 'ACTIVE', items: [] })) },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Berikan Akses' }));
    expect(await screen.findByText('Tidak ada user yang bisa diberi akses.')).toBeInTheDocument();
    cleanup();
    setup({
      api: {
        listGrantableUsers: vi.fn(async () => {
          throw new Error('secret');
        }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Berikan Akses' }));
    expect(await screen.findByText(/Daftar user belum bisa dimuat/)).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('a blocked creator disables Berikan Akses and Berikan Ulang', async () => {
    setup({ blocked: true });
    await screen.findByText('Raka Putra');
    expect(screen.getByRole('button', { name: 'Berikan Akses' })).toBeDisabled();
    expect(
      within(rowOf('Nadia Kusuma')).getByRole('button', { name: /^Berikan ulang/ }),
    ).toBeDisabled();
  });
});
