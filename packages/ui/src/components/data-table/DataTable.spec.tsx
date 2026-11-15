import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, TableToolbar, type Column, type DataTableProps } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Creator', sortable: true, sticky: 'start', render: (r) => r.name },
  { key: 'action', header: 'Aksi', sticky: 'end', render: () => <button>View</button> },
];

const pagination = {
  page: 1,
  pageSize: 10,
  total: 3,
  onPageChange: () => {},
  onPageSizeChange: () => {},
};

function setup(props: Partial<DataTableProps<Row>> = {}) {
  const onSortChange = vi.fn();
  const onRetry = vi.fn();
  const onResetFilters = vi.fn();
  render(
    <DataTable<Row>
      label="Creator"
      columns={columns}
      rows={[]}
      status="ready"
      rowKey={(r) => r.id}
      pagination={pagination}
      onSortChange={onSortChange}
      onRetry={onRetry}
      onResetFilters={onResetFilters}
      {...props}
    />,
  );
  return { onSortChange, onRetry, onResetFilters };
}

describe('DataTable states', () => {
  it('shows the skeleton while loading, with "Memuat data…" and no rows', () => {
    setup({ status: 'loading', rows: [{ id: '1', name: 'Salsa' }] });
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Memuat data…')).toBeInTheDocument();
    expect(screen.queryByText('Salsa')).not.toBeInTheDocument();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(6);
  });

  it('shows "Belum ada data" when empty without filters', () => {
    setup();
    expect(screen.getByText('Belum ada data')).toBeInTheDocument();
    expect(screen.getByText('Data akan muncul di sini setelah ada aktivitas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Filter' })).not.toBeInTheDocument();
  });

  it('shows "Tidak ada hasil" with Reset Filter when filters are active', async () => {
    const { onResetFilters } = setup({ hasActiveFilters: true });
    expect(screen.getByText('Tidak ada hasil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset Filter' }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it('shows the error state and retries with "Coba Lagi"', async () => {
    const { onRetry } = setup({ status: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Data gagal dimuat');
    expect(screen.getByText('Menampilkan 0 hasil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders rows exactly as given, without sorting them', () => {
    setup({
      rows: [
        { id: '2', name: 'Zed' },
        { id: '1', name: 'Amy' },
        { id: '3', name: 'Mia' },
      ],
    });
    const cells = Array.from(document.querySelectorAll('tbody tr td:first-child')).map(
      (td) => td.textContent,
    );
    expect(cells).toEqual(['Zed', 'Amy', 'Mia']);
    expect(screen.queryByText('Belum ada data')).not.toBeInTheDocument();
  });
});

describe('DataTable sorting', () => {
  it('reports ascending first, then toggles to descending', async () => {
    const { onSortChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Creator' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'asc' });
  });

  it('toggles an ascending column to descending', async () => {
    const { onSortChange } = setup({ sort: { key: 'name', direction: 'asc' } });
    await userEvent.click(screen.getByRole('button', { name: 'Creator' }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' });
  });

  it('sets aria-sort and leaves unsortable columns without a sort button', () => {
    setup({ sort: { key: 'name', direction: 'desc' } });
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveAttribute('aria-sort', 'descending');
    expect(headers[1]).not.toHaveAttribute('aria-sort');
    expect(within(headers[1] as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('marks inactive sortable columns as none', () => {
    setup();
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-sort', 'none');
  });
});

describe('TableToolbar', () => {
  it('renders its controls and calls onReset', async () => {
    const onReset = vi.fn();
    render(
      <TableToolbar onReset={onReset}>
        <input aria-label="Cari" />
      </TableToolbar>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reset Filter' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Cari')).toBeInTheDocument();
  });
});
