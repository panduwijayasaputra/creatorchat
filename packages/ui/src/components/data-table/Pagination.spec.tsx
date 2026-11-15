import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination, rangeText } from './Pagination';

function setup(props: Partial<Parameters<typeof Pagination>[0]> = {}) {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  render(
    <Pagination
      page={1}
      pageSize={10}
      total={126}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />,
  );
  return { onPageChange, onPageSizeChange };
}

describe('rangeText', () => {
  it.each([
    [1, 10, 126, 'Menampilkan 1–10 dari 126 hasil'],
    [2, 10, 126, 'Menampilkan 11–20 dari 126 hasil'],
    [13, 10, 126, 'Menampilkan 121–126 dari 126 hasil'],
    [1, 10, 4, 'Menampilkan 1–4 dari 4 hasil'],
    [1, 10, 0, 'Menampilkan 0 hasil'],
  ])('page %i size %i total %i', (page, size, total, text) => {
    expect(rangeText(page, size, total)).toBe(text);
  });
});

describe('Pagination', () => {
  it('shows the range and the page buttons', () => {
    setup();
    expect(screen.getByText('Menampilkan 1–10 dari 126 hasil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Halaman 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Halaman 13' })).toBeInTheDocument();
  });

  it('offers exactly 10/25/50 rows per page', () => {
    setup();
    const select = screen.getByRole('combobox', { name: 'Baris per halaman' });
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.value)).toEqual([
      '10',
      '25',
      '50',
    ]);
  });

  it('reports a page size change as a number', async () => {
    const { onPageSizeChange } = setup();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Baris per halaman' }),
      '25',
    );
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  it('disables previous on the first page and next on the last', () => {
    setup({ page: 1 });
    expect(screen.getByRole('button', { name: 'Halaman sebelumnya' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Halaman berikutnya' })).toBeEnabled();
  });

  it('disables next on the last page', () => {
    setup({ page: 13 });
    expect(screen.getByRole('button', { name: 'Halaman berikutnya' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Halaman sebelumnya' })).toBeEnabled();
  });

  it('navigates with next, previous and page buttons', async () => {
    const { onPageChange } = setup({ page: 5 });
    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await userEvent.click(screen.getByRole('button', { name: 'Halaman sebelumnya' }));
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 13' }));
    expect(onPageChange.mock.calls.map((c) => c[0])).toEqual([6, 4, 13]);
  });

  it('never emits the current page or an out-of-range page', async () => {
    const { onPageChange } = setup({ page: 1, total: 5 });
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 1' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('shows "Menampilkan 0 hasil" and a single page when empty', () => {
    setup({ total: 0 });
    expect(screen.getByText('Menampilkan 0 hasil')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Halaman 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Halaman berikutnya' })).toBeDisabled();
  });

  it('shows "Memuat data…" while loading', () => {
    setup({ loading: true });
    expect(screen.getByText('Memuat data…')).toBeInTheDocument();
  });
});
