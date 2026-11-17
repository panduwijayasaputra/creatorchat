import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExploreItem, ExploreResponse } from '@creatorchat/contracts';
import { ExplorePage } from './ExplorePage';

afterEach(cleanup);

const item = (
  code: string,
  name: string,
  access: ExploreItem['access'],
  bio: string | null = `Bio ${name}`,
): ExploreItem => ({
  public_code: code,
  display_name: name,
  bio,
  avatar_url: null,
  access,
});
const BOARD = [
  item('salsa234', 'Salsa Maheswari', 'ACTIVE'),
  item('dinda234', 'Dinda Prameswari', 'PENDING'),
  item('kirana23', 'Kirana Larasati', 'EXPIRED'),
  item('lonely23', 'Lonely Creator', null),
];
const page = (items: ExploreItem[], total = items.length, n = 1): ExploreResponse => ({
  items,
  total,
  page: n,
  page_size: 20,
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function setup(listCreators: (q: { page: number; page_size: number }) => Promise<ExploreResponse>) {
  const api = { listCreators: vi.fn(listCreators) };
  render(
    <MemoryRouter initialEntries={['/explore']}>
      <Routes>
        <Route path="/explore" element={<ExplorePage api={api} />} />
        <Route path="/creators/:code" element={<div>profile</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return api;
}

describe('cards', () => {
  it('shows the board title, a card per creator and the viewer-own chip with icon and label', async () => {
    const api = setup(async () => page(BOARD));
    expect(await screen.findByRole('heading', { name: 'Jelajahi' })).toBeInTheDocument();
    expect(api.listCreators).toHaveBeenCalledWith({ page: 1, page_size: 20 });
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    for (const [index, chip] of [
      [0, 'Aktif'],
      [1, 'Menunggu'],
      [2, 'Berakhir'],
    ] as const) {
      const card = cards[index] as HTMLElement;
      expect(within(card).getByText(chip)).toBeInTheDocument();
      expect(card.querySelector('svg')).not.toBeNull();
    }
    const lonely = cards[3] as HTMLElement;
    expect(within(lonely).queryByText(/Aktif|Menunggu|Berakhir/)).toBeNull();
    expect(within(cards[0] as HTMLElement).getByText('Bio Salsa Maheswari')).toBeInTheDocument();
  });

  it('Profil goes to the creator by public code', async () => {
    setup(async () => page(BOARD));
    await userEvent.click(await screen.findByRole('link', { name: 'Profil Dinda Prameswari' }));
    expect(await screen.findByText('profile')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/creators/dinda234');
  });

  it('renders names and bios as text', async () => {
    setup(async () => page([item('xxxxxxxx', '<img src=x onerror=alert(1)>', null, '<b>hi</b>')]));
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('a card without a bio shows no empty line', async () => {
    setup(async () => page([item('xxxxxxxx', 'Salsa', null, null)]));
    await screen.findByText('Salsa');
    expect(document.querySelector('[class*="bio"]')).toBeNull();
  });
});

describe('paging and states', () => {
  it('Muat lagi appends the next page and disappears at the end', async () => {
    const api = setup(async ({ page: n }) =>
      n === 1 ? page(BOARD.slice(0, 2), 3, 1) : page(BOARD.slice(2, 3), 3, 2),
    );
    await screen.findByText('Salsa Maheswari');
    await userEvent.click(screen.getByRole('button', { name: 'Muat lagi' }));
    expect(await screen.findByText('Kirana Larasati')).toBeInTheDocument();
    expect(api.listCreators).toHaveBeenLastCalledWith({ page: 2, page_size: 20 });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Muat lagi' })).toBeNull();
  });

  it('a failed next page keeps the list and says so', async () => {
    setup(async ({ page: n }) => {
      if (n === 2) throw new Error('secret');
      return page(BOARD.slice(0, 2), 4, 1);
    });
    await screen.findByText('Salsa Maheswari');
    await userEvent.click(screen.getByRole('button', { name: 'Muat lagi' }));
    expect(await screen.findByText('Daftar creator belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows loading, the empty state, and an error with retry', async () => {
    setup(async () => page([]));
    expect(screen.getByRole('status')).toHaveTextContent('Memuat creator…');
    expect(await screen.findByText('Belum ada creator.')).toBeInTheDocument();
    cleanup();
    let fail = true;
    const api = setup(async () => {
      if (fail) throw new Error('secret');
      return page(BOARD);
    });
    expect(await screen.findByText('Daftar creator belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Salsa Maheswari')).toBeInTheDocument();
    expect(api.listCreators).toHaveBeenCalledTimes(2);
  });
});
