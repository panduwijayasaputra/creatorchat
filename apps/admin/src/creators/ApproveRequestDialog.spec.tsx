import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApproveCreatorRequestResponse } from '@creatorchat/contracts';
import { ApiError, NetworkError } from '../auth/api-client';
import { ApproveRequestDialog } from './ApproveRequestDialog';
import { MAYA, RAKA, REQUEST_ID, SALSA_BLOCK, review } from '../preview/review-fixtures';

afterEach(cleanup);

const APPROVED: ApproveCreatorRequestResponse = {
  request: { ...MAYA, status: 'APPROVED', reviewed_at: '2026-11-14T08:03:00.000Z' },
  creator: { id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44', public_code: 'k4m5x2qa' },
};

function setup(
  options: {
    get?: () => Promise<ReturnType<typeof review>>;
    approve?: () => Promise<ApproveCreatorRequestResponse>;
  } = {},
) {
  const api = {
    getCreatorRequest: vi.fn(options.get ?? (async () => review(MAYA))),
    approveCreatorRequest: vi.fn(options.approve ?? (async () => APPROVED)),
  };
  const onClose = vi.fn();
  const onDecided = vi.fn();
  render(
    <ApproveRequestDialog
      requestId={REQUEST_ID}
      open
      api={api}
      onClose={onClose}
      onDecided={onDecided}
    />,
  );
  return { api, onClose, onDecided };
}

const confirmButton = () => screen.getByRole('button', { name: /Setujui Creator|Memproses/ });
const ready = () => screen.findByText('Maya Lestari');

describe('ApproveRequestDialog', () => {
  it('shows the board: title, applicant, consequence, the re-check line and the note', async () => {
    const { api } = setup();
    expect(
      await screen.findByRole('dialog', { name: 'Setujui permintaan creator?' }),
    ).toBeVisible();
    await ready();
    expect(screen.getByText('@mayalestari · ID 582917403 · Creator Asli')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('CREATOR')).toBeInTheDocument();
    expect(
      screen.getByText(/Ini mengubah role akun yang sama, bukan membuat akun baru/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Diperiksa ulang: tidak ada langganan pelanggan aktif (15.02 WIB)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pemberitahuan dikirim ke user melalui bot Telegram. Tindakan dicatat di audit log.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeEnabled();
    expect(confirmButton()).toBeEnabled();
    // The only identifier the client sends is the application id.
    expect(api.getCreatorRequest).toHaveBeenCalledWith(REQUEST_ID);
  });

  it('opens in the cannot-approve state when the pre-check finds a subscription', async () => {
    setup({ get: async () => review(RAKA, SALSA_BLOCK) });
    await screen.findByText('Raka Putra');
    expect(screen.getByText('Tidak bisa disetujui')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Akun ini masih memiliki 1 langganan pelanggan aktif: Salsa Maheswari, hingga 27 Nov 2026. Permintaan dapat disetujui setelah seluruh langganan berakhir.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Kamu masih bisa menolak permintaan dengan alasan.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Diperiksa ulang/)).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('keeps the confirm button inert while loading and after a failed load, then recovers on retry', async () => {
    const user = userEvent.setup();
    const get = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(review(MAYA));
    const { api } = setup({ get });
    expect(confirmButton()).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan belum bisa dimuat.');
    expect(confirmButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await ready();
    expect(confirmButton()).toBeEnabled();
    expect(api.getCreatorRequest).toHaveBeenCalledTimes(2);
  });

  it('shows Memproses… while the call runs, blocks Batal, fires once on a double click and reports', async () => {
    const user = userEvent.setup();
    let release: (value: ApproveCreatorRequestResponse) => void = () => {};
    const { api, onClose, onDecided } = setup({
      approve: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    await ready();
    await user.dblClick(confirmButton());
    const busy = await screen.findByRole('button', { name: 'Memproses…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
    expect(api.approveCreatorRequest).toHaveBeenCalledTimes(1);
    expect(api.approveCreatorRequest).toHaveBeenCalledWith(REQUEST_ID);
    release(APPROVED);
    await waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({ kind: 'approved', response: APPROVED }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('turns a 409 CREATOR_APPROVAL_BLOCKED into the cannot-approve state with the server details', async () => {
    const approve = vi.fn().mockRejectedValue(
      new ApiError(409, 'CREATOR_APPROVAL_BLOCKED', 'x', {
        count: 2,
        creator_name: 'Kirana Larasati',
        ends_at: '2026-12-05T00:00:00.000Z',
      }),
    );
    const { onClose, onDecided } = setup({ approve });
    await ready();
    await userEvent.click(confirmButton());
    expect(
      await screen.findByText(
        'Akun ini masih memiliki 2 langganan pelanggan aktif: Kirana Larasati, hingga 5 Des 2026. Permintaan dapat disetujui setelah seluruh langganan berakhir.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('reports a 409 CREATOR_REQUEST_ALREADY_REVIEWED with the winning status and closes without an error', async () => {
    const approve = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'CREATOR_REQUEST_ALREADY_REVIEWED', 'x', { status: 'REJECTED' }),
      );
    const { onClose, onDecided } = setup({ approve });
    await ready();
    await userEvent.click(confirmButton());
    await waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({ kind: 'already_reviewed', status: 'REJECTED' }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains an ineligible account inline and stays usable', async () => {
    const approve = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'CREATOR_REQUEST_ACCOUNT_NOT_ELIGIBLE', 'x'));
    const { onDecided } = setup({ approve });
    await ready();
    await userEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Akun ini tidak bisa disetujui karena diblokir atau bukan akun USER.',
    );
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('shows a generic inline failure for any other error, never its message, and can retry', async () => {
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'SECRET stack detail'))
      .mockResolvedValueOnce(APPROVED);
    const { onDecided } = setup({ approve });
    await ready();
    await userEvent.click(confirmButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Gagal memproses. Coba lagi.');
    expect(alert).not.toHaveTextContent('SECRET');
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });

  it('renders applicant text as text, never as markup', async () => {
    const evil = { ...MAYA, creator_name: '<img src=x onerror=alert(1)>Maya' };
    setup({ get: async () => review(evil) });
    expect(await screen.findByText('<img src=x onerror=alert(1)>Maya')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
