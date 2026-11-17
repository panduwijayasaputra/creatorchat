import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api-client';
import { AUDIT_DETAIL } from '../../test/creator-detail-fixtures';
import { LogDetailPage } from './LogDetailPage';

afterEach(cleanup);

function setup(
  get: (id: string) => Promise<typeof AUDIT_DETAIL>,
  state?: { from: string; label: string },
) {
  const getAuditLog = vi.fn(get);
  render(
    <MemoryRouter initialEntries={[{ pathname: `/logs/${AUDIT_DETAIL.id}`, state }]}>
      <Routes>
        <Route path="/logs/:id" element={<LogDetailPage api={{ getAuditLog }} />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return getAuditLog;
}

describe('Detail Log', () => {
  it('shows every row and the before / after panels', async () => {
    setup(async () => AUDIT_DETAIL);
    expect(await screen.findByText('13 Nov 2026, 11.20.18 WIB (UTC+7)')).toBeInTheDocument();
    for (const text of [
      'Admin Nadia',
      'Block creator',
      'Citra Anindya (creator)',
      'Berhasil',
      'Active → Blocked',
      'Pelanggaran ketentuan konten setelah laporan pengguna.',
      'SEBELUM',
      'SESUDAH',
      'Entri audit tidak bisa diubah atau dihapus.',
      /Password, token, API key/,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('req_7c1f9a40e2').className).toMatch(/mono/);
    expect(screen.getByText('Status: Active', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Status: Blocked', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kembali ke Audit Admin' })).toHaveAttribute(
      'href',
      '/logs',
    );
  });

  it('hides reason and request id when absent and shows a dash for empty panels', async () => {
    setup(async () => ({ ...AUDIT_DETAIL, reason: null, request_id: null, before: [], after: [] }));
    await screen.findByText('Admin Nadia');
    expect(screen.queryByText('Alasan')).toBeNull();
    expect(screen.queryByText('Request ID')).toBeNull();
  });

  it('goes back to the page the person came from', async () => {
    setup(async () => AUDIT_DETAIL, {
      from: '/creators/abc/history?page=2',
      label: 'Kembali ke History Creator',
    });
    const link = await screen.findByRole('link', { name: 'Kembali ke History Creator' });
    expect(link).toHaveAttribute('href', '/creators/abc/history?page=2');
    await userEvent.click(link);
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });

  it('renders text as text', async () => {
    setup(async () => ({ ...AUDIT_DETAIL, actor: '<img src=x onerror=alert(1)>' }));
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('shows not found for a 404 and a generic error with retry', async () => {
    setup(async () => {
      throw new ApiError(404, 'NOT_FOUND', 'x');
    });
    expect(await screen.findByText('Log tidak ditemukan')).toBeInTheDocument();
    cleanup();
    let fail = true;
    setup(async () => {
      if (fail) throw new Error('secret');
      return AUDIT_DETAIL;
    });
    expect(await screen.findByText('Log belum bisa dimuat.')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    expect(await screen.findByText('Admin Nadia')).toBeInTheDocument();
  });
});
