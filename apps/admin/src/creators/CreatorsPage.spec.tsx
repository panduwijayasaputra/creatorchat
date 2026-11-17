import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorListQuery, CreatorListResponse } from '@creatorchat/contracts';
import { ApiError, type CreatorModerationApi, type CreatorReviewApi } from '../auth/api-client';
import { LUNA, MAYA, review } from '../preview/review-fixtures';
import { LIST_ROWS, listFrom } from '../../test/creator-list-fixtures';
import { CreatorsPage } from './CreatorsPage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

type ListFn = (query: CreatorListQuery, signal?: AbortSignal) => Promise<CreatorListResponse>;

function setup(
  options: {
    list?: ListFn;
    url?: string;
    rows?: typeof LIST_ROWS;
    review?: Partial<CreatorReviewApi>;
    moderation?: Partial<CreatorModerationApi>;
  } = {},
) {
  const reviewApi: CreatorReviewApi = {
    getCreatorRequest: vi.fn(async (id: string) => review({ ...MAYA, id })),
    approveCreatorRequest: vi.fn(async (id: string) => ({
      request: {
        ...MAYA,
        id,
        status: 'APPROVED' as const,
        reviewed_at: '2026-11-16T08:00:00.000Z',
      },
      creator: { id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44', public_code: 'k4m5x2qa' },
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
    ...options.review,
  };
  const moderationApi: CreatorModerationApi = {
    getBlockCheck: vi.fn(async () => ({
      creator_status: 'ACTIVE' as const,
      active_subscribers: 37,
      checked_at: '2026-11-16T08:00:00.000Z',
    })),
    blockCreator: vi.fn(async (id: string) => ({
      creator: { id, status: 'BLOCKED' as const },
      active_subscribers: 37,
    })),
    unblockCreator: vi.fn(async (id: string) => ({
      creator: { id, status: 'ACTIVE' as const },
    })),
    ...options.moderation,
  };
  const list = vi.fn<ListFn>(
    options.list ?? (async (query) => listFrom(options.rows ?? LIST_ROWS, query)),
  );
  render(
    <MemoryRouter initialEntries={[options.url ?? '/creators']}>
      <Routes>
        <Route
          path="/creators"
          element={<CreatorsPage api={{ listCreators: list, ...reviewApi, ...moderationApi }} />}
        />
        <Route path="/creators/:id" element={<div>detail</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return {
    list,
    review: reviewApi,
    moderation: moderationApi,
    last: () => list.mock.calls.at(-1)?.[0] as CreatorListQuery,
  };
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

describe('Creator list: content', () => {
  it('shows the board copy, columns and the server range', async () => {
    setup();
    expect(
      await screen.findByText(
        /Default menampilkan request menunggu serta creator Active dan Blocked/,
      ),
    ).toBeInTheDocument();
    for (const header of [
      'Creator',
      'Telegram',
      'Instagram',
      'Jenis',
      'Status',
      'Subscriber',
      'Tanggal',
      'Aksi',
    ]) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${header}`) }),
      ).toBeInTheDocument();
    }
    expect(await screen.findByText('Menampilkan 1–10 dari 19 hasil')).toBeInTheDocument();
    const maya = rowOf('Maya Lestari');
    expect(within(maya).getByText('@mayalestari')).toBeInTheDocument();
    expect(within(maya).getByText('ID 582917403')).toBeInTheDocument();
    expect(within(maya).getByText('@maya.lestari')).toBeInTheDocument();
    expect(within(maya).getByText('Creator Asli')).toBeInTheDocument();
    expect(within(maya).getByText('Request')).toBeInTheDocument();
    expect(within(maya).getByText('–')).toBeInTheDocument();
    expect(within(maya).getByText('14 Nov 2026')).toBeInTheDocument();
    expect(within(rowOf('Luna Aurora')).getByText('Karakter AI')).toBeInTheDocument();
    expect(within(rowOf('Tika Wardani')).getByText('37')).toBeInTheDocument();
  });

  it('shows "Langganan aktif" only for a flagged request', async () => {
    setup();
    await screen.findByText('Maya Lestari');
    expect(within(rowOf('Raka Putra')).getByText('Langganan aktif')).toBeInTheDocument();
    expect(within(rowOf('Maya Lestari')).queryByText('Langganan aktif')).toBeNull();
    expect(within(rowOf('Tika Wardani')).queryByText('Langganan aktif')).toBeNull();
  });

  it('gives each row the actions of its status', async () => {
    const { list } = setup();
    await screen.findByText('Maya Lestari');
    const request = rowOf('Maya Lestari');
    expect(within(request).getByRole('button', { name: /^View/ })).toBeEnabled();
    expect(within(request).getByRole('button', { name: /^Setujui/ })).toBeEnabled();
    expect(within(request).getByRole('button', { name: /^Tolak/ })).toBeEnabled();
    const active = within(rowOf('Tika Wardani')).getByRole('button', { name: /^Block/ });
    const blocked = within(rowOf('Fajar Nugroho')).getByRole('button', { name: /^Unblock/ });
    expect(active).toBeEnabled();
    expect(blocked).toBeEnabled();
    expect(list).toHaveBeenCalled();
    expect(within(rowOf('Tika Wardani')).queryByRole('button', { name: /^Setujui/ })).toBeNull();
  });

  it('opens the detail route from View', async () => {
    setup();
    await screen.findByText('Maya Lestari');
    await userEvent.click(within(rowOf('Maya Lestari')).getByRole('button', { name: /^View/ }));
    expect(await screen.findByText('detail')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/creators/00000000-0000-4000-8000-000000000001',
    );
  });

  it('renders applicant text as text, never as markup', async () => {
    const evil = {
      ...LIST_ROWS[0]!,
      creator_name: '<img src=x onerror=alert(1)>',
      telegram_username: '<b>x</b>',
    };
    setup({ rows: [evil] });
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('@<b>x</b>')).toBeInTheDocument();
  });
});

describe('Creator list: the URL is the view', () => {
  it('sends the query parsed from the URL, and falls back for garbage values', async () => {
    const { last } = setup({
      url: '/creators?status=request&type=ai_character&sort=name&dir=asc&page=1&page_size=25&sort=password',
    });
    await screen.findByText('Luna Aurora');
    expect(last()).toMatchObject({ status: ['request'], type: 'ai_character', page_size: 25 });
    const bad = setup({ url: '/creators?sort=password&page=0&page_size=20' });
    await waitFor(() => expect(bad.list).toHaveBeenCalled());
    expect(bad.last()).toMatchObject({ sort: 'date', page: 1, page_size: 10 });
  });

  it('each filter sends its value to the server and resets the page', async () => {
    const { last } = setup();
    await screen.findByText('Maya Lestari');
    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(last().page).toBe(2));
    await userEvent.selectOptions(screen.getByLabelText('Jenis'), 'Karakter AI');
    await waitFor(() => expect(last()).toMatchObject({ type: 'ai_character', page: 1 }));
    expect(screen.getByTestId('where').textContent).toContain('type=ai_character');
    expect(screen.getByTestId('where').textContent).not.toContain('page=');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Active, Blocked');
    await waitFor(() => expect(last().status).toEqual(['active', 'blocked']));
    await userEvent.selectOptions(screen.getByLabelText('Tanggal'), '30 hari terakhir');
    await waitFor(() => expect(last().range).toBe('30d'));
  });

  it('sort and page size go to the server and reset the page', async () => {
    const { last } = setup();
    await screen.findByText('Maya Lestari');
    await userEvent.click(screen.getByRole('button', { name: /^Creator/ }));
    await waitFor(() => expect(last()).toMatchObject({ sort: 'name', dir: 'asc', page: 1 }));
    await userEvent.click(screen.getByRole('button', { name: /^Creator/ }));
    await waitFor(() => expect(last().dir).toBe('desc'));
    await userEvent.selectOptions(screen.getByLabelText('Baris per halaman'), '25');
    await waitFor(() => expect(last()).toMatchObject({ page_size: 25, page: 1 }));
    expect(await screen.findByText('Menampilkan 1–19 dari 19 hasil')).toBeInTheDocument();
  });

  it('search waits for a pause, then queries and resets the page', async () => {
    const { list, last } = setup({ url: '/creators?page=2' });
    await screen.findByText(/Menampilkan 11–19/);
    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'luna');
    expect(list.mock.calls.every(([q]) => q.q === null)).toBe(true);
    await waitFor(() => expect(last()).toMatchObject({ q: 'luna', page: 1 }));
    expect(await screen.findByText('Luna Aurora')).toBeInTheDocument();
  });

  it('Reset Filter restores the default filters and keeps sort', async () => {
    const { last } = setup({ url: '/creators?q=zzz&status=blocked&type=human&sort=name&dir=asc' });
    expect(await screen.findByText('Tidak ada hasil')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Filter' })[0]!);
    await waitFor(() =>
      expect(last()).toMatchObject({
        q: null,
        status: ['request', 'active', 'blocked'],
        type: 'all',
        sort: 'name',
        dir: 'asc',
      }),
    );
    expect(await screen.findByText('Citra Anindya')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('ignores a slow older answer that arrives after a newer one', async () => {
    let releaseFirst: (r: CreatorListResponse) => void = () => undefined;
    let n = 0;
    const { last } = setup({
      list: (query, signal) => {
        n += 1;
        if (n === 1) {
          return new Promise((resolve, reject) => {
            releaseFirst = resolve;
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return Promise.resolve(listFrom(LIST_ROWS, query));
      },
    });
    await userEvent.selectOptions(screen.getByLabelText('Jenis'), 'Karakter AI');
    expect(await screen.findByText('Luna Aurora')).toBeInTheDocument();
    releaseFirst({ items: [], total: 0, page: 1, page_size: 10 }); // stale
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('Luna Aurora')).toBeInTheDocument();
    expect(last().type).toBe('ai_character');
  });

  it('moves to the last page when the current page is past the end', async () => {
    const { last } = setup({ url: '/creators?page=9' });
    await waitFor(() => expect(last().page).toBe(2));
    expect(await screen.findByText(/Menampilkan 11–19 dari 19 hasil/)).toBeInTheDocument();
  });
});

describe('Creator list: states (AdmTableStates)', () => {
  it('shows the loading skeleton and "Memuat data…"', async () => {
    setup({ list: () => new Promise(() => undefined) });
    expect(await screen.findByText('Memuat data…')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Creator' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows "Belum ada data" with no rows and no filters', async () => {
    setup({ rows: [] });
    expect(await screen.findByText('Belum ada data')).toBeInTheDocument();
    expect(screen.getByText('Menampilkan 0 hasil')).toBeInTheDocument();
  });

  it('shows "Tidak ada hasil" with a Reset Filter when filters are active', async () => {
    setup({ url: '/creators?q=zzz' });
    expect(await screen.findByText('Tidak ada hasil')).toBeInTheDocument();
  });

  it('shows an error with Retry that never repeats the thrown message', async () => {
    let fail = true;
    const { list } = setup({
      list: async (query) => {
        if (fail) throw new ApiError(500, 'INTERNAL_ERROR', 'secret stack trace');
        return listFrom(LIST_ROWS, query);
      },
    });
    expect(await screen.findByText('Data gagal dimuat')).toBeInTheDocument();
    expect(screen.queryByText(/secret stack trace/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Maya Lestari')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('Creator list: responsive boards', () => {
  it('tablet: four columns, only the Status filter, scroll hint, no intro', async () => {
    mediaMode('tablet');
    setup();
    await screen.findByText('Maya Lestari');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Creator',
      'Status',
      'Subscriber',
      'Aksi',
    ]);
    expect(screen.queryByLabelText('Jenis')).toBeNull();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(
      screen.getByText('Geser tabel ke samping untuk melihat seluruh kolom.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Default menampilkan/)).toBeNull();
  });

  it('mobile: search and a Filter button that opens the (gap) panel with the same controls', async () => {
    mediaMode('mobile');
    const { last } = setup();
    await screen.findByText('Maya Lestari');
    expect(screen.getByPlaceholderText('Cari creator')).toBeInTheDocument();
    expect(screen.queryByLabelText('Jenis')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.selectOptions(screen.getByLabelText('Jenis'), 'Creator Asli');
    await waitFor(() => expect(last().type).toBe('human'));
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Tanggal')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filter' })).getByRole('button', {
        name: 'Reset Filter',
      }),
    );
    await waitFor(() => expect(last().type).toBe('all'));
  });
});

const MAYA_ROW = LIST_ROWS[0]!;
const LUNA_ROW = LIST_ROWS[2]!;

describe('Creator list: decisions from the rows (US-012 dialogs)', () => {
  it('approves from the row: one call with the row id, then the list is fetched again', async () => {
    const rows = LIST_ROWS.map((r) => ({ ...r }));
    const t = setup({
      list: async (query) => listFrom(rows, query),
      review: {
        approveCreatorRequest: vi.fn(async (id: string) => {
          rows[0] = { ...rows[0]!, kind: 'creator', status: 'ACTIVE', subscriber_count: 0 };
          return {
            request: {
              ...MAYA,
              id,
              status: 'APPROVED' as const,
              reviewed_at: '2026-11-16T08:00:00.000Z',
            },
            creator: { id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44', public_code: 'k4m5x2qa' },
          };
        }),
      },
    });
    await screen.findByText('Maya Lestari');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Maya Lestari')).getByRole('button', { name: /^Setujui/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText(/Diperiksa ulang/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Setujui Creator' }));
    await waitFor(() => expect(t.list.mock.calls.length).toBeGreaterThan(before));
    expect(t.review.approveCreatorRequest).toHaveBeenCalledTimes(1);
    expect(t.review.approveCreatorRequest).toHaveBeenCalledWith(MAYA_ROW.id);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(within(rowOf('Maya Lestari')).getByText('Active')).toBeInTheDocument(),
    );
    expect(within(rowOf('Maya Lestari')).queryByRole('button', { name: /^Setujui/ })).toBeNull();
  });

  it('rejects from the row: reason trimmed, only the id, the board toast, then a refetch', async () => {
    const t = setup();
    await screen.findByText('Luna Aurora');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Luna Aurora')).getByRole('button', { name: /^Tolak/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText(/Alasan penolakan/);
    await userEvent.type(within(dialog).getByRole('textbox'), '  Link belum valid.  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tolak Permintaan' }));
    expect(
      await screen.findByText('Permintaan Luna Aurora ditolak dan dicatat'),
    ).toBeInTheDocument();
    expect(t.review.rejectCreatorRequest).toHaveBeenCalledWith(LUNA_ROW.id, 'Link belum valid.');
    expect(t.list.mock.calls.length).toBeGreaterThan(before);
  });

  it('an already-reviewed answer only refreshes the list: no error, no toast', async () => {
    const t = setup({
      review: {
        approveCreatorRequest: vi.fn(async () => {
          throw new ApiError(409, 'CREATOR_REQUEST_ALREADY_REVIEWED', 'x', { status: 'REJECTED' });
        }),
      },
    });
    await screen.findByText('Maya Lestari');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Maya Lestari')).getByRole('button', { name: /^Setujui/ }));
    await screen.findByText(/Diperiksa ulang/);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Setujui Creator' }),
    );
    await waitFor(() => expect(t.list.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/ditolak dan dicatat/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a blocked approval stays in the dialog and does not reload the list', async () => {
    const t = setup({
      review: {
        approveCreatorRequest: vi.fn(async () => {
          throw new ApiError(409, 'CREATOR_APPROVAL_BLOCKED', 'x', {
            count: 1,
            creator_name: 'Salsa Maheswari',
            ends_at: '2026-11-27T00:00:00.000Z',
          });
        }),
      },
    });
    await screen.findByText('Raka Putra');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Raka Putra')).getByRole('button', { name: /^Setujui/ }));
    await screen.findByText(/Diperiksa ulang/);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Setujui Creator' }),
    );
    expect(await screen.findByText('Tidak bisa disetujui')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(t.list.mock.calls.length).toBe(before);
  });

  it('a double click sends one approval', async () => {
    const t = setup({
      review: { approveCreatorRequest: vi.fn(() => new Promise<never>(() => undefined)) },
    });
    await screen.findByText('Maya Lestari');
    await userEvent.click(within(rowOf('Maya Lestari')).getByRole('button', { name: /^Setujui/ }));
    await screen.findByText(/Diperiksa ulang/);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Setujui Creator',
    });
    await userEvent.dblClick(confirm);
    expect(t.review.approveCreatorRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps the filters, sort and page in the URL across a decision', async () => {
    const t = setup({ url: '/creators?status=request&sort=name&dir=asc&page_size=25' });
    await screen.findByText('Maya Lestari');
    await userEvent.click(within(rowOf('Luna Aurora')).getByRole('button', { name: /^Tolak/ }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText(/Alasan penolakan/);
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tolak Permintaan' }));
    await screen.findByText(/ditolak dan dicatat/);
    expect(screen.getByTestId('where').textContent).toContain('status=request');
    expect(screen.getByTestId('where').textContent).toContain('sort=name');
    expect(t.last()).toMatchObject({ status: ['request'], sort: 'name', page_size: 25 });
  });

  it('gives the focus back to the button that opened the dialog', async () => {
    setup();
    await screen.findByText('Maya Lestari');
    const opener = within(rowOf('Maya Lestari')).getByRole('button', { name: /^Tolak/ });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});

describe('Creator list: block and unblock', () => {
  it('blocks from the row: live count, reason trimmed, only the id, toast, then a refetch', async () => {
    const t = setup();
    await screen.findByText('Tika Wardani');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Tika Wardani')).getByRole('button', { name: /^Block/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('37 subscriber aktif')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), '  Pelanggaran.  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block Creator' }));
    expect(await screen.findByText('Tika Wardani diblokir.')).toBeInTheDocument();
    expect(t.moderation.blockCreator).toHaveBeenCalledWith(expect.any(String), 'Pelanggaran.');
    expect(t.list.mock.calls.length).toBeGreaterThan(before);
  });

  it('unblocks from the row with the board toast', async () => {
    const t = setup();
    await screen.findByText('Fajar Nugroho');
    await userEvent.click(within(rowOf('Fajar Nugroho')).getByRole('button', { name: /^Unblock/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Banding diterima.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unblock Creator' }));
    expect(await screen.findByText('Fajar Nugroho kembali Active')).toBeInTheDocument();
    expect(t.moderation.unblockCreator).toHaveBeenCalledWith(
      expect.any(String),
      'Banding diterima.',
    );
  });

  it('a status conflict refreshes the list with a notice', async () => {
    const t = setup({
      moderation: {
        unblockCreator: vi.fn(async () => {
          throw new ApiError(409, 'CREATOR_STATUS_CONFLICT', 'x', { status: 'ACTIVE' });
        }),
      },
    });
    await screen.findByText('Fajar Nugroho');
    const before = t.list.mock.calls.length;
    await userEvent.click(within(rowOf('Fajar Nugroho')).getByRole('button', { name: /^Unblock/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unblock Creator' }));
    expect(await screen.findByText(/sudah berubah/)).toBeInTheDocument();
    await waitFor(() => expect(t.list.mock.calls.length).toBeGreaterThan(before));
  });
});
