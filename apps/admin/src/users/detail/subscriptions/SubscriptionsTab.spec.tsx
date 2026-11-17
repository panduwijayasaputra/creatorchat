import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionListResponse, SubscriptionRow } from '@creatorchat/contracts';
import { ToastProvider } from '@creatorchat/ui';
import { ApiError, type UserSubscriptionsApi } from '../../../auth/api-client';
import { SubscriptionsTab } from './SubscriptionsTab';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const USER = {
  id: '10000000-0000-4000-8000-000000000009',
  display_name: 'Raka Putra',
  telegram_username: 'rakaputra',
  telegram_id: '691042285',
};
const SALSA_ID = '2c000000-0000-4000-8000-000000000001';
const KIRANA_ID = '2c000000-0000-4000-8000-000000000002';
const SALSA: SubscriptionRow = {
  id: '5b000000-0000-4000-8000-000000000001',
  creator: { id: SALSA_ID, display_name: 'Salsa Maheswari', avatar_url: null },
  status: 'ACTIVE',
  starts_at: '2026-10-28T05:00:00.000Z',
  ends_at: '2026-11-27T16:59:59.000Z',
  revoked_at: null,
};
const KIRANA: SubscriptionRow = {
  id: '5b000000-0000-4000-8000-000000000002',
  creator: { id: KIRANA_ID, display_name: 'Kirana Larasati', avatar_url: null },
  status: 'EXPIRED',
  starts_at: '2026-10-07T05:00:00.000Z',
  ends_at: '2026-11-06T16:59:59.000Z',
  revoked_at: null,
};
const page = (items: SubscriptionRow[]): SubscriptionListResponse => ({
  items,
  total: items.length,
  page: 1,
  page_size: 10,
});
const ACTION = (row: SubscriptionRow, ends_at = '2026-12-14T16:59:59.000Z') => ({
  subscription: {
    id: row.id,
    creator_id: row.creator.id,
    status: 'ACTIVE' as const,
    starts_at: row.starts_at,
    ends_at,
    revoked_at: null,
  },
});

function Where() {
  const l = useLocation();
  return (
    <>
      <div data-testid="where">{l.search}</div>
      <div data-testid="path">{l.pathname}</div>
      <div data-testid="from">{(l.state as { from?: string } | null)?.from}</div>
    </>
  );
}

function setup(
  overrides: Partial<Record<keyof UserSubscriptionsApi, unknown>> = {},
  options: { blocked?: boolean; url?: string } = {},
) {
  const api = {
    listUserSubscriptions: vi.fn(async () => page([SALSA, KIRANA])),
    listAccessRequests: vi.fn(async () => ({ items: [] })),
    rejectAccessRequest: vi.fn(),
    getGrantableCreators: vi.fn(async () => ({
      items: [
        { id: KIRANA_ID, display_name: 'Kirana Larasati', avatar_url: null },
        { id: SALSA_ID, display_name: 'Salsa Maheswari', avatar_url: null },
      ],
    })),
    grantAccess: vi.fn(async () => ACTION(KIRANA)),
    extendAccess: vi.fn(async () => ACTION(SALSA, '2026-12-27T16:59:59.000Z')),
    revokeAccess: vi.fn(async () => ({
      subscription: { ...ACTION(SALSA).subscription, status: 'REVOKED' as const },
    })),
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={[options.url ?? '/']}>
      <ToastProvider>
        <SubscriptionsTab
          api={api as unknown as UserSubscriptionsApi}
          user={USER}
          blocked={options.blocked ?? false}
        />
      </ToastProvider>
      <Where />
    </MemoryRouter>,
  );
  return api;
}

const dialog = (name: string) => screen.findByRole('dialog', { name });

describe('table', () => {
  it('shows each row with its status and the actions that fit it', async () => {
    setup();
    const salsa = (await screen.findByText('Salsa Maheswari')).closest('tr') as HTMLElement;
    const kirana = screen.getByText('Kirana Larasati').closest('tr') as HTMLElement;
    expect(within(salsa).getByText('Active')).toBeInTheDocument();
    expect(within(salsa).getByText('28 Okt 2026')).toBeInTheDocument();
    expect(within(salsa).getByText('27 Nov 2026')).toBeInTheDocument();
    expect(within(salsa).getByRole('button', { name: /^Perpanjang akses/ })).toBeEnabled();
    expect(within(salsa).getByRole('button', { name: /^Cabut akses/ })).toBeEnabled();
    expect(within(salsa).queryByText('Berikan Ulang')).toBeNull();
    expect(within(kirana).getByText('Kedaluwarsa')).toBeInTheDocument();
    expect(within(kirana).getByRole('button', { name: /^Berikan ulang akses/ })).toBeEnabled();
    expect(within(kirana).queryByText('Perpanjang')).toBeNull();
    expect(within(kirana).queryByText('Cabut')).toBeNull();
    // View waits for US-021
    expect(within(salsa).getByRole('button', { name: /^View akses/ })).toBeEnabled();
    expect(screen.getByText(/Tidak ada transaksi pembayaran\./)).toBeInTheDocument();
  });

  it('labels a revoked row Dicabut with Berikan Ulang', async () => {
    setup({
      listUserSubscriptions: vi.fn(async () =>
        page([{ ...SALSA, status: 'REVOKED', revoked_at: '2026-11-14T05:00:00.000Z' }]),
      ),
    });
    const row = (await screen.findByText('Salsa Maheswari')).closest('tr') as HTMLElement;
    // the status filter also has a "Dicabut" option, so look inside the row
    expect(within(row).getByText('Dicabut')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Berikan ulang akses/ })).toBeInTheDocument();
    expect(within(row).queryByText('Kedaluwarsa')).toBeNull();
  });

  it('sends search, filters, sort and paging to the server and keeps them in the URL', async () => {
    const api = setup();
    await screen.findByText('Salsa Maheswari');
    await userEvent.type(screen.getByPlaceholderText('Cari creator'), 'sal');
    await waitFor(() =>
      expect(api.listUserSubscriptions).toHaveBeenLastCalledWith(
        USER.id,
        expect.objectContaining({ q: 'sal' }),
        expect.anything(),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active');
    await userEvent.selectOptions(screen.getByLabelText('Berakhir'), 'next7');
    await waitFor(() =>
      expect(api.listUserSubscriptions).toHaveBeenLastCalledWith(
        USER.id,
        expect.objectContaining({ q: 'sal', status: 'active', ends: 'next7', page: 1 }),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('q=sal&status=active&ends=next7');
    await userEvent.click(screen.getByRole('button', { name: 'Reset Filter' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^$/));
  });

  it('shows the error state and retries', async () => {
    const listUserSubscriptions = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(page([SALSA]));
    setup({ listUserSubscriptions });
    await userEvent.click(await screen.findByRole('button', { name: /Coba Lagi/ }));
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
  });

  it('renders a creator name as text', async () => {
    const evil = {
      ...SALSA,
      creator: { ...SALSA.creator, display_name: '<img src=x onerror=alert(1)>' },
    };
    setup({ listUserSubscriptions: vi.fn(async () => page([evil])) });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('disables the grant buttons for a blocked account', async () => {
    setup({}, { blocked: true });
    await screen.findByText('Salsa Maheswari');
    expect(screen.getByRole('button', { name: 'Berikan Akses' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Berikan ulang akses/ })).toBeDisabled();
  });
});

describe('grant', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T05:00:00.000Z'));
  });

  async function open(api = setup()) {
    await screen.findByText('Salsa Maheswari');
    await userEvent.click(screen.getByRole('button', { name: 'Berikan Akses' }));
    const dlg = await dialog('Berikan akses?');
    await within(dlg).findByLabelText('Creator');
    return { api, dlg };
  }

  it('previews 30 days to 23.59 WIB and grants with the duration and the reason', async () => {
    const { api, dlg } = await open();
    expect(within(dlg).getByText('14 Des 2026, 23.59 WIB')).toBeInTheDocument();
    expect(within(dlg).getByText('@rakaputra · ID 691042285')).toBeInTheDocument();
    const confirm = within(dlg).getByRole('button', { name: 'Berikan Akses' });
    expect(confirm).toBeDisabled(); // reason required
    await userEvent.type(
      within(dlg).getByLabelText('Alasan (wajib)'),
      '  Kompensasi gangguan layanan pekan lalu.  ',
    );
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.grantAccess).toHaveBeenCalledWith(USER.id, {
        creator_id: KIRANA_ID,
        duration_days: 30,
        reason: 'Kompensasi gangguan layanan pekan lalu.',
      }),
    );
    expect(
      await screen.findByText('Akses Raka Putra ke Kirana Larasati diberikan hingga 14 Des 2026'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.listUserSubscriptions).toHaveBeenCalledTimes(2); // refetched
  });

  it('recomputes the end date for another duration and for a custom date', async () => {
    const { api, dlg } = await open();
    await userEvent.selectOptions(within(dlg).getByLabelText('Durasi'), '7');
    expect(within(dlg).getByText('21 Nov 2026, 23.59 WIB')).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText('Tanggal berakhir'), {
      target: { value: '2026-12-31' },
    });
    expect(within(dlg).getByText('31 Des 2026, 23.59 WIB')).toBeInTheDocument();
    expect(within(dlg).getByLabelText('Durasi')).toHaveValue('custom');
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'Bonus');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    await waitFor(() =>
      expect(api.grantAccess).toHaveBeenCalledWith(USER.id, {
        creator_id: KIRANA_ID,
        end_date: '2026-12-31',
        reason: 'Bonus',
      }),
    );
  });

  it('refuses a custom date outside the allowed range', async () => {
    const { dlg } = await open();
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'x');
    fireEvent.change(within(dlg).getByLabelText('Tanggal berakhir'), {
      target: { value: '2026-11-14' },
    });
    expect(within(dlg).getByText('Tanggal berakhir belum valid.')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Berikan Akses' })).toBeDisabled();
  });

  it('sends once on a double click', async () => {
    const { api, dlg } = await open();
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'x');
    await userEvent.dblClick(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    await waitFor(() => expect(api.grantAccess).toHaveBeenCalledTimes(1));
  });

  it('closes with the conflict toast and refetches on a 409', async () => {
    const grantAccess = vi.fn().mockRejectedValue(new ApiError(409, 'SUBSCRIPTION_ACTIVE', 'x'));
    const { api, dlg } = await open(setup({ grantAccess }));
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'x');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    expect(
      await screen.findByText('Status akses Raka Putra sudah berubah. Daftar diperbarui.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.listUserSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('stays open with the failure banner and the typed reason on a server error', async () => {
    const grantAccess = vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    const { dlg } = await open(setup({ grantAccess }));
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'Alasan saya');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Gagal memproses. Coba lagi.');
    expect(within(dlg).getByLabelText('Alasan (wajib)')).toHaveValue('Alasan saya');
  });

  it('says so when no creator can be granted, and offers a retry when loading fails', async () => {
    cleanup();
    setup({ getGrantableCreators: vi.fn(async () => ({ items: [] })) });
    await userEvent.click(await screen.findByRole('button', { name: 'Berikan Akses' }));
    const dlg = await dialog('Berikan akses?');
    expect(
      await within(dlg).findByText('Tidak ada creator yang bisa diberi akses.'),
    ).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Berikan Akses' })).toBeDisabled();
    cleanup();
    const getGrantableCreators = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue({
        items: [{ id: KIRANA_ID, display_name: 'Kirana Larasati', avatar_url: null }],
      });
    setup({ getGrantableCreators });
    await userEvent.click(await screen.findByRole('button', { name: 'Berikan Akses' }));
    const dlg2 = await dialog('Berikan akses?');
    await userEvent.click(await within(dlg2).findByRole('button', { name: 'Coba Lagi' }));
    expect(await within(dlg2).findByLabelText('Creator')).toHaveValue(KIRANA_ID);
  });

  it('Berikan Ulang locks the creator to the row', async () => {
    const api = setup();
    await userEvent.click(
      await screen.findByRole('button', { name: /^Berikan ulang akses Kirana/ }),
    );
    const dlg = await dialog('Berikan akses?');
    const select = await within(dlg).findByLabelText('Creator');
    expect(select).toBeDisabled();
    expect(select).toHaveValue(KIRANA_ID);
    expect(api.getGrantableCreators).not.toHaveBeenCalled();
  });
});

describe('extend and revoke', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T05:00:00.000Z'));
  });

  it('extends: shows the new end date and sends the duration and reason', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: /^Perpanjang akses Salsa/ }));
    const dlg = await dialog('Perpanjang akses?');
    expect(within(dlg).getByText('Raka Putra → Salsa Maheswari')).toBeInTheDocument();
    expect(within(dlg).getByText('Akses aktif hingga 27 Nov 2026')).toBeInTheDocument();
    expect(within(dlg).getByText('27 Des 2026, 23.59 WIB')).toBeInTheDocument();
    await userEvent.selectOptions(within(dlg).getByLabelText('Tambah durasi'), '90');
    expect(within(dlg).getByText('25 Feb 2027, 23.59 WIB')).toBeInTheDocument();
    await userEvent.selectOptions(within(dlg).getByLabelText('Tambah durasi'), '30');
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'Permintaan user.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Perpanjang Akses' }));
    await waitFor(() =>
      expect(api.extendAccess).toHaveBeenCalledWith(USER.id, SALSA.id, {
        duration_days: 30,
        reason: 'Permintaan user.',
      }),
    );
    expect(
      await screen.findByText(
        'Akses Raka Putra ke Salsa Maheswari diperpanjang hingga 27 Des 2026',
      ),
    ).toBeInTheDocument();
  });

  it('revokes with the reason and shows the dicabut toast', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: /^Cabut akses Salsa/ }));
    const dlg = await dialog('Cabut akses?');
    expect(within(dlg).getByText('sekarang')).toBeInTheDocument();
    expect(within(dlg).getByLabelText('Alasan pencabutan (wajib)')).toBeInTheDocument();
    const confirm = within(dlg).getByRole('button', { name: 'Cabut Akses' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dlg).getByLabelText('Alasan pencabutan (wajib)'),
      'Pelanggaran ketentuan layanan.',
    );
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.revokeAccess).toHaveBeenCalledWith(
        USER.id,
        SALSA.id,
        'Pelanggaran ketentuan layanan.',
      ),
    );
    expect(
      await screen.findByText('Akses Raka Putra ke Salsa Maheswari dicabut'),
    ).toBeInTheDocument();
  });

  it('shows the conflict toast when the access already changed', async () => {
    const revokeAccess = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'SUBSCRIPTION_NOT_ACTIVE', 'x'));
    setup({ revokeAccess });
    await userEvent.click(await screen.findByRole('button', { name: /^Cabut akses Salsa/ }));
    const dlg = await dialog('Cabut akses?');
    await userEvent.type(within(dlg).getByLabelText('Alasan pencabutan (wajib)'), 'x');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cabut Akses' }));
    expect(
      await screen.findByText('Status akses Raka Putra sudah berubah. Daftar diperbarui.'),
    ).toBeInTheDocument();
  });
});

describe('View (US-021)', () => {
  it('opens the subscription detail and remembers the list URL for the way back', async () => {
    setup({}, { url: `/users/${USER.id}/subscriptions?status=active&page=1` });
    const row = (await screen.findByText('Salsa Maheswari')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /^View akses/ }));
    expect(screen.getByTestId('path')).toHaveTextContent(
      `/users/${USER.id}/subscriptions/${SALSA.id}`,
    );
    expect(screen.getByTestId('from')).toHaveTextContent(
      `/users/${USER.id}/subscriptions?status=active`,
    );
  });
});

describe('pending access requests (US-024)', () => {
  const REQ_ID = '7a000000-0000-4000-8000-000000000001';
  const DINDA_ID = '2c000000-0000-4000-8000-000000000003';
  const PENDING_REQ = {
    id: REQ_ID,
    creator: { id: DINDA_ID, display_name: 'Dinda Prameswari' },
    type: 'TRIAL' as 'TRIAL' | 'RENEWAL',
    requested_at: '2026-11-13T03:42:00.000Z',
  };
  const withRequests = (items = [PENDING_REQ]) => ({
    listAccessRequests: vi.fn(async () => ({ items })),
    rejectAccessRequest: vi.fn(async () => ({
      request: { id: REQ_ID, status: 'REJECTED' as const },
    })),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T05:00:00.000Z'));
  });

  it('shows one banner per request with the type, the sent time and both buttons', async () => {
    setup(
      withRequests([
        PENDING_REQ,
        { ...PENDING_REQ, id: '7a000000-0000-4000-8000-000000000002', type: 'RENEWAL' as const },
      ]),
    );
    expect(
      await screen.findByText('Permintaan akses uji coba ke Dinda Prameswari'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Permintaan perpanjangan akses ke Dinda Prameswari'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Dikirim 13 Nov 2026, 10.42 WIB')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Setujui permintaan akses/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Tolak permintaan akses/ })).toHaveLength(2);
  });

  it('shows nothing without requests', async () => {
    setup(withRequests([]));
    await screen.findByText('Salsa Maheswari');
    expect(screen.queryByText(/Permintaan akses uji coba/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Permintaan akses' })).toBeNull();
  });

  it('offers a retry when the requests cannot be loaded', async () => {
    const listAccessRequests = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [PENDING_REQ] });
    setup({ listAccessRequests });
    expect(await screen.findByText('Permintaan akses belum bisa dimuat.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(
      await screen.findByText('Permintaan akses uji coba ke Dinda Prameswari'),
    ).toBeInTheDocument();
  });

  it('Setujui opens the grant dialog with the creator fixed and sends the request id', async () => {
    const api = setup({
      ...withRequests(),
      grantAccess: vi.fn(async () => ACTION(KIRANA)),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Setujui permintaan akses ke Dinda Prameswari' }),
    );
    const dlg = await dialog('Berikan akses?');
    expect(await within(dlg).findByLabelText('Creator')).toBeInTheDocument();
    expect(within(dlg).getAllByText(/Dinda Prameswari/).length).toBeGreaterThan(0);
    expect(api.getGrantableCreators).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'Disetujui admin.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    await waitFor(() =>
      expect(api.grantAccess).toHaveBeenCalledWith(USER.id, {
        creator_id: DINDA_ID,
        duration_days: 30,
        reason: 'Disetujui admin.',
        access_request_id: REQ_ID,
      }),
    );
    await waitFor(() => expect(api.listAccessRequests).toHaveBeenCalledTimes(2));
  });

  it('Setujui is disabled for a blocked account, Tolak stays available', async () => {
    setup(withRequests(), { blocked: true });
    expect(
      await screen.findByRole('button', { name: 'Setujui permintaan akses ke Dinda Prameswari' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Tolak permintaan akses ke Dinda Prameswari' }),
    ).toBeEnabled();
  });

  it('a 409 on approve closes the dialog, shows the conflict toast and refetches both lists', async () => {
    const api = setup({
      ...withRequests(),
      grantAccess: vi.fn(async () => {
        throw new ApiError(409, 'ACCESS_REQUEST_ALREADY_REVIEWED', 'Reviewed.', {
          status: 'REJECTED',
        });
      }),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Setujui permintaan akses ke Dinda Prameswari' }),
    );
    const dlg = await dialog('Berikan akses?');
    await userEvent.type(within(dlg).getByLabelText('Alasan (wajib)'), 'Disetujui admin.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Berikan Akses' }));
    expect(
      await screen.findByText('Status akses Raka Putra sudah berubah. Daftar diperbarui.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listAccessRequests).toHaveBeenCalledTimes(2));
    expect(api.listUserSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('Tolak needs a reason, sends it once on a double click, then toasts and refetches', async () => {
    const api = setup(withRequests());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Tolak permintaan akses ke Dinda Prameswari' }),
    );
    const dlg = await dialog('Tolak permintaan akses?');
    const confirm = within(dlg).getByRole('button', { name: 'Tolak Permintaan' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dlg).getByLabelText('Alasan penolakan (wajib)'),
      '  Belum sesuai.  ',
    );
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(api.rejectAccessRequest).toHaveBeenCalledTimes(1));
    expect(api.rejectAccessRequest).toHaveBeenCalledWith(USER.id, REQ_ID, 'Belum sesuai.');
    expect(
      await screen.findByText('Permintaan akses Raka Putra ke Dinda Prameswari ditolak'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.listAccessRequests).toHaveBeenCalledTimes(2));
  });

  it('Tolak: a 409 shows the reviewed toast; another failure keeps the dialog and the reason', async () => {
    const reject = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(
        new ApiError(409, 'ACCESS_REQUEST_ALREADY_REVIEWED', 'Reviewed.', { status: 'APPROVED' }),
      );
    const api = setup({ ...withRequests(), rejectAccessRequest: reject });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Tolak permintaan akses ke Dinda Prameswari' }),
    );
    const dlg = await dialog('Tolak permintaan akses?');
    await userEvent.type(within(dlg).getByLabelText('Alasan penolakan (wajib)'), 'Belum sesuai.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Tolak Permintaan' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Gagal memproses. Coba lagi.');
    expect(within(dlg).getByLabelText('Alasan penolakan (wajib)')).toHaveValue('Belum sesuai.');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Tolak Permintaan' }));
    expect(
      await screen.findByText('Permintaan akses Raka Putra sudah ditinjau. Daftar diperbarui.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.listAccessRequests).toHaveBeenCalledTimes(2));
  });

  it('renders a creator name in a banner as text', async () => {
    setup(
      withRequests([
        { ...PENDING_REQ, creator: { ...PENDING_REQ.creator, display_name: '<b>x</b>' } },
      ]),
    );
    expect(await screen.findByText('Permintaan akses uji coba ke <b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });
});
