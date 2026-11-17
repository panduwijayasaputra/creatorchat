import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserListQuery, UserListResponse } from '@creatorchat/contracts';
import { ApiError, type UserModerationApi } from '../auth/api-client';
import { USER_ROWS, userListFrom } from '../../test/user-list-fixtures';
import { UsersPage } from './UsersPage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

type ListFn = (query: UserListQuery, signal?: AbortSignal) => Promise<UserListResponse>;

function setup(
  options: {
    list?: ListFn;
    url?: string;
    rows?: typeof USER_ROWS;
    moderation?: Partial<UserModerationApi>;
  } = {},
) {
  const moderation: UserModerationApi = {
    getUserBlockCheck: vi.fn(async () => ({
      user_status: 'ACTIVE' as const,
      role: 'USER' as const,
      active_subscriptions: 1,
      checked_at: '2026-11-16T08:00:00.000Z',
    })),
    blockUser: vi.fn(async (id: string) => ({ user: { id, status: 'BLOCKED' as const } })),
    unblockUser: vi.fn(async (id: string) => ({ user: { id, status: 'ACTIVE' as const } })),
    ...options.moderation,
  };
  const list = vi.fn<ListFn>(
    options.list ?? (async (query) => userListFrom(options.rows ?? USER_ROWS, query)),
  );
  render(
    <MemoryRouter initialEntries={[options.url ?? '/users']}>
      <Routes>
        <Route path="/users" element={<UsersPage api={{ listUsers: list, ...moderation }} />} />
        <Route path="/users/:id" element={<div>detail</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { list, moderation, last: () => list.mock.calls.at(-1)?.[0] as UserListQuery };
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

function mediaMode(mode: 'desktop' | 'tablet' | 'mobile') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      (query.includes('1279') && mode !== 'desktop') ||
      (query.includes('767') && mode === 'mobile'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('User list: content', () => {
  it('shows the board copy, columns and the server range', async () => {
    setup();
    expect(
      await screen.findByText(/Hanya akun dengan role USER\. Akun yang disetujui menjadi creator/),
    ).toBeInTheDocument();
    for (const header of [
      'Pengguna',
      'Telegram',
      'Status',
      'Langganan aktif',
      'Pengajuan creator',
      'Bergabung',
      'Aksi',
    ]) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${header}`) }),
      ).toBeInTheDocument();
    }
    expect(await screen.findByText('Menampilkan 1–10 dari 23 hasil')).toBeInTheDocument();
    const hendra = rowOf('Hendra Wijaya');
    expect(within(hendra).getByText('@hendraw')).toBeInTheDocument();
    expect(within(hendra).getByText('ID 299017733')).toBeInTheDocument();
    expect(within(hendra).getByText('Active')).toBeInTheDocument();
    expect(within(hendra).getByText('Belum mengajukan')).toBeInTheDocument();
    expect(within(hendra).getByText('13 Nov 2026')).toBeInTheDocument();
    expect(within(rowOf('Maya Lestari')).getByText('Menunggu')).toBeInTheDocument();
    expect(within(rowOf('Bima Arya')).getByText('Ditolak')).toBeInTheDocument();
    expect(within(rowOf('Dimas Aditya')).getByText('Blocked')).toBeInTheDocument();
  });

  it('gives Active rows Block and Blocked rows Unblock, both live', async () => {
    setup();
    await screen.findByText('Hendra Wijaya');
    expect(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Block/ })).toBeEnabled();
    expect(within(rowOf('Dimas Aditya')).getByRole('button', { name: /^Unblock/ })).toBeEnabled();
    expect(within(rowOf('Hendra Wijaya')).queryByRole('button', { name: /^Unblock/ })).toBeNull();
    expect(within(rowOf('Dimas Aditya')).queryByRole('button', { name: /^Block/ })).toBeNull();
  });

  it('View goes to the user detail route', async () => {
    setup();
    await screen.findByText('Hendra Wijaya');
    await userEvent.click(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^View/ }));
    expect(await screen.findByText('detail')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/users/10000000-0000-4000-8000-000000000001',
    );
  });

  it('renders a hostile name as text', async () => {
    const rows = [{ ...USER_ROWS[0]!, display_name: '<img src=x onerror=alert(1)>' }];
    setup({ rows });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('User list: server-side query and URL', () => {
  it('sends each filter, sort and size change and resets the page', async () => {
    const { last } = setup({ url: '/users?page=2' });
    await screen.findByText('Menampilkan 11–20 dari 23 hasil');
    expect(last().page).toBe(2);
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Pengguna/ }).querySelector('button')!,
    );
    await waitFor(() => expect(last()).toMatchObject({ sort: 'name', page: 1 }));
    expect(screen.getByTestId('where')).toHaveTextContent('sort=name');
  });

  it('shows the Permintaan akses chip only for users with pending access requests (US-024)', async () => {
    const rows = USER_ROWS.map((r) =>
      r.display_name === 'Raka Putra'
        ? { ...r, pending_access_count: 2 }
        : r.display_name === 'Hendra Wijaya'
          ? { ...r, pending_access_count: 1 }
          : r,
    );
    setup({ rows });
    await screen.findByText('Hendra Wijaya');
    expect(within(rowOf('Hendra Wijaya')).getByText('Permintaan akses')).toBeInTheDocument();
    expect(within(rowOf('Hendra Wijaya')).queryByText(/\(1\)/)).toBeNull();
    expect(within(rowOf('Raka Putra')).getByText('Permintaan akses (2)')).toBeInTheDocument();
    expect(within(rowOf('Putri Ayu')).queryByText(/Permintaan akses/)).toBeNull();
  });

  it('filters by pending access requests, keeps it in the URL and resets it (US-024)', async () => {
    const rows = USER_ROWS.map((r) =>
      r.display_name === 'Raka Putra' ? { ...r, pending_access_count: 1 } : r,
    );
    const { last } = setup({ rows });
    await screen.findByText('Hendra Wijaya');
    await userEvent.selectOptions(screen.getByLabelText('Akses'), 'pending');
    await waitFor(() => expect(last()).toMatchObject({ access: 'pending', page: 1 }));
    expect(screen.getByTestId('where')).toHaveTextContent('access=pending');
    expect(await screen.findByText('Menampilkan 1–1 dari 1 hasil')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Filter' })[0]!);
    await waitFor(() => expect(last()).toMatchObject({ access: 'any' }));
  });

  it('reads access from the URL and falls back to any on garbage (US-024)', async () => {
    const { last } = setup({ url: '/users?access=pending' });
    await waitFor(() => expect(last()?.access).toBe('pending'));
    cleanup();
    const again = setup({ url: '/users?access=bogus' });
    await screen.findByText('Hendra Wijaya');
    expect(again.last().access).toBe('any');
  });

  it('keeps filters from the URL and falls back on garbage', async () => {
    const { last } = setup({
      url: '/users?status=blocked&request=none&sort=hax&page=abc&range=30d',
    });
    await screen.findByText('Dimas Aditya');
    expect(last()).toMatchObject({
      status: ['blocked'],
      request: ['none'],
      range: '30d',
      sort: 'date',
      page: 1,
    });
  });

  it('search is debounced into the URL and the query, page reset', async () => {
    const { last } = setup({ url: '/users?page=2' });
    await screen.findByText('Menampilkan 11–20 dari 23 hasil');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByLabelText('Cari nama atau Telegram ID'), {
      target: { value: 'hendra' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await waitFor(() => expect(last()).toMatchObject({ q: 'hendra', page: 1 }));
    expect(screen.getByTestId('where')).toHaveTextContent('q=hendra');
    expect(await screen.findByText('Menampilkan 1–1 dari 1 hasil')).toBeInTheDocument();
  });

  it('Reset Filter restores the defaults', async () => {
    const { last } = setup({ url: '/users?status=blocked&q=zzz' });
    await screen.findByText(/Tidak ada hasil/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Filter' })[0]!);
    await waitFor(() => expect(last()).toMatchObject({ q: null, status: ['active', 'blocked'] }));
    expect(await screen.findByText('Hendra Wijaya')).toBeInTheDocument();
  });

  it('ignores a stale response', async () => {
    let release: (r: UserListResponse) => void = () => undefined;
    const slow = new Promise<UserListResponse>((resolve) => (release = resolve));
    const { list } = setup({
      list: (query) =>
        query.sort === 'name' ? slow : Promise.resolve(userListFrom(USER_ROWS, query)),
    });
    await screen.findByText('Hendra Wijaya');
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Pengguna/ }).querySelector('button')!,
    );
    await userEvent.click(
      screen.getByRole('columnheader', { name: /^Bergabung/ }).querySelector('button')!,
    );
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(2));
    release(userListFrom([USER_ROWS[9]!], { ...list.mock.calls[0]![0] }));
    await act(async () => undefined);
    expect(screen.queryByText('Menampilkan 1–1 dari 1 hasil')).toBeNull();
  });
});

describe('User list: states', () => {
  it('shows the empty state without filters', async () => {
    setup({ rows: [] });
    expect(await screen.findByText('Belum ada data')).toBeInTheDocument();
  });

  it('shows no-results with filters', async () => {
    setup({ url: '/users?q=zzz' });
    expect(await screen.findByText('Tidak ada hasil')).toBeInTheDocument();
  });

  it('shows a generic error and retries', async () => {
    let fail = true;
    const { list } = setup({
      list: async (query) => {
        if (fail) throw new Error('secret db detail');
        return userListFrom(USER_ROWS, query);
      },
    });
    expect(await screen.findByRole('button', { name: /Coba Lagi|Retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/secret db detail/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Coba Lagi|Retry/i }));
    expect(await screen.findByText('Hendra Wijaya')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('User list: mobile', () => {
  it('shows Filter and the scroll hint', async () => {
    mediaMode('mobile');
    setup();
    await screen.findByText('Hendra Wijaya');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByText(/Geser tabel ke samping/)).toBeInTheDocument();
  });
});

describe('Users list: block and unblock from the rows (US-019)', () => {
  const HENDRA = USER_ROWS.find((r) => r.display_name === 'Hendra Wijaya')!;
  const DIMAS = USER_ROWS.find((r) => r.display_name === 'Dimas Aditya')!;

  it('blocks from the row: one call with the user id and the trimmed reason, the toast, a refetch', async () => {
    const rows = USER_ROWS.map((r) => ({ ...r }));
    const t = setup({
      list: async (query) => userListFrom(rows, query),
      moderation: {
        blockUser: vi.fn(async (id: string) => {
          const row = rows.find((r) => r.id === id)!;
          row.status = 'BLOCKED';
          return { user: { id, status: 'BLOCKED' as const } };
        }),
      },
    });
    await screen.findByText('Hendra Wijaya');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Block/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('(1)');
    await userEvent.type(within(dialog).getByRole('textbox'), '  Spam berulang  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block User' }));
    expect(await screen.findByText('Hendra Wijaya diblokir')).toBeInTheDocument();
    expect(t.moderation.blockUser).toHaveBeenCalledTimes(1);
    expect(t.moderation.blockUser).toHaveBeenCalledWith(HENDRA.id, 'Spam berulang');
    await waitFor(() => expect(t.list.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(within(rowOf('Hendra Wijaya')).getByText('Blocked')).toBeInTheDocument(),
    );
    expect(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Unblock/ })).toBeEnabled();
  });

  it('unblocks from the row with the board toast', async () => {
    const t = setup();
    await screen.findByText('Dimas Aditya');
    await userEvent.click(within(rowOf('Dimas Aditya')).getByRole('button', { name: /^Unblock/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Banding diterima');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unblock User' }));
    expect(await screen.findByText('Dimas Aditya kembali Active')).toBeInTheDocument();
    expect(t.moderation.unblockUser).toHaveBeenCalledWith(DIMAS.id, 'Banding diterima');
  });

  it('a conflict only refreshes the list, with the info toast', async () => {
    const t = setup({
      moderation: {
        blockUser: vi.fn(async () => {
          throw new ApiError(409, 'USER_STATUS_CONFLICT', 'x', { status: 'BLOCKED' });
        }),
      },
    });
    await screen.findByText('Hendra Wijaya');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Block/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('(1)');
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block User' }));
    expect(
      await screen.findByText('Status Hendra Wijaya sudah berubah. Daftar diperbarui.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(t.list.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the filters, sort and page in the URL across a decision', async () => {
    const t = setup({ url: '/users?status=active&sort=name&dir=asc&page_size=25' });
    await screen.findByText('Hendra Wijaya');
    await userEvent.click(within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Block/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('(1)');
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block User' }));
    await screen.findByText('Hendra Wijaya diblokir');
    expect(screen.getByTestId('where').textContent).toContain('status=active');
    expect(t.last()).toMatchObject({ status: ['active'], sort: 'name', page_size: 25 });
  });

  it('gives the focus back to the button that opened the dialog', async () => {
    setup();
    await screen.findByText('Hendra Wijaya');
    const opener = within(rowOf('Hendra Wijaya')).getByRole('button', { name: /^Block/ });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});
