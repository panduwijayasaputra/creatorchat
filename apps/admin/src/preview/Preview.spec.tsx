import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Preview } from './Preview';

afterEach(cleanup);

const SECTIONS = [
  'palette',
  'status-buttons',
  'inputs',
  'tabs-kv',
  'toast-dialog',
  'creator-review',
  'table-loading',
  'table-empty',
  'table-no-results',
  'table-error',
  'table-ready',
];

describe('Admin component preview', () => {
  it('renders every section', () => {
    const { container } = render(<Preview />);
    const ids = Array.from(container.querySelectorAll('[data-preview-section]')).map((n) =>
      n.getAttribute('data-preview-section'),
    );
    for (const id of SECTIONS) expect(ids).toContain(id);
  });

  it('shows all nine status chips with their labels', () => {
    render(<Preview />);
    const section = document.querySelector(
      '[data-preview-section="status-buttons"]',
    ) as HTMLElement;
    for (const label of [
      'Request',
      'Active',
      'Blocked',
      'Berhasil',
      'Gagal',
      'Kedaluwarsa',
      'Ditolak',
      'Menunggu',
      'Belum mengajukan',
    ]) {
      expect(within(section).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the four table states from AdmTableStates', () => {
    render(<Preview />);
    expect(screen.getByText('Belum ada data')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada hasil')).toBeInTheDocument();
    expect(screen.getByText('Data gagal dimuat')).toBeInTheDocument();
    expect(screen.getAllByText('Memuat data…').length).toBeGreaterThan(0);
  });

  it('fires the slow dialog confirm once under a double click and blocks Batal meanwhile', async () => {
    render(<Preview />);
    await userEvent.click(screen.getByRole('button', { name: 'Dialog lambat' }));
    const dialog = screen.getByRole('dialog', { name: 'Simulasi lambat' });
    await userEvent.dblClick(within(dialog).getByRole('button', { name: 'Proses' }));
    expect(within(dialog).getByRole('button', { name: 'Proses' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeDisabled();
  });

  it('shows the failure inline for the failing dialog', async () => {
    render(<Preview />);
    await userEvent.click(screen.getByRole('button', { name: 'Dialog gagal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Coba Proses' }));
    const dialog = screen.getByRole('dialog', { name: 'Simulasi gagal' });
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Gagal memproses'),
    );
  });

  it('opens the creator review dialogs from the preview, with Raka blocked by his subscription', async () => {
    render(<Preview />);
    const section = document.querySelector(
      '[data-preview-section="creator-review"]',
    ) as HTMLElement;
    await userEvent.click(within(section).getByRole('button', { name: 'Setujui (Maya)' }));
    expect(
      await screen.findByText('Diperiksa ulang: tidak ada langganan pelanggan aktif (15.02 WIB)'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(
      within(section).getByRole('button', { name: 'Setujui (langganan aktif)' }),
    );
    expect(await screen.findByText('Tidak bisa disetujui')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(section).getByRole('button', { name: 'Tolak (Luna)' }));
    expect(await screen.findByLabelText('Alasan penolakan (wajib)')).toBeInTheDocument();
  });
});
