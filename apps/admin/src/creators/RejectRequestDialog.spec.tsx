import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RejectCreatorRequestResponse } from '@creatorchat/contracts';
import { ApiError, NetworkError } from '../auth/api-client';
import { RejectRequestDialog } from './RejectRequestDialog';
import { LUNA, REQUEST_ID, review } from '../preview/review-fixtures';

afterEach(cleanup);

const REJECTED: RejectCreatorRequestResponse = {
  request: {
    ...LUNA,
    status: 'REJECTED',
    reviewed_at: '2026-11-14T08:03:00.000Z',
    review_reason: 'Belum jelas.',
  },
};

function setup(
  options: {
    get?: () => Promise<ReturnType<typeof review>>;
    reject?: (id: string, reason: string) => Promise<RejectCreatorRequestResponse>;
  } = {},
) {
  const api = {
    getCreatorRequest: vi.fn(options.get ?? (async () => review(LUNA))),
    rejectCreatorRequest: vi.fn(options.reject ?? (async () => REJECTED)),
  };
  const onClose = vi.fn();
  const onDecided = vi.fn();
  render(
    <RejectRequestDialog
      requestId={REQUEST_ID}
      open
      api={api}
      onClose={onClose}
      onDecided={onDecided}
    />,
  );
  return { api, onClose, onDecided };
}

const reasonField = () => screen.getByLabelText('Alasan penolakan (wajib)');
const confirmButton = () => screen.getByRole('button', { name: 'Tolak Permintaan' });
const ready = () => screen.findByText('Luna Aurora');

describe('RejectRequestDialog', () => {
  it('shows the board: title, applicant, consequence, the required reason and its hint', async () => {
    setup();
    expect(await screen.findByRole('dialog', { name: 'Tolak permintaan creator?' })).toBeVisible();
    await ready();
    expect(screen.getByText('@lunaaurora · ID 774120936 · Karakter AI')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Permintaan ditolak dan dicatat di History. Akun tetap USER dan dapat mengajukan lagi. Alasan dikirim ke user melalui Telegram.',
      ),
    ).toBeInTheDocument();
    expect(reasonField()).toHaveAttribute('placeholder', 'Tulis alasan singkat');
    expect(screen.getByText('Alasan dicatat di audit log.')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('shows "Alasan wajib diisi." for an empty or blank reason and sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await ready();
    await user.type(reasonField(), 'x');
    await user.clear(reasonField());
    expect(screen.getByText('Alasan wajib diisi.')).toBeInTheDocument();
    expect(reasonField()).toHaveAttribute('aria-invalid', 'true');
    expect(confirmButton()).toBeDisabled();
    await user.type(reasonField(), '   ');
    expect(screen.getByText('Alasan wajib diisi.')).toBeInTheDocument();
    await user.click(confirmButton());
    expect(api.rejectCreatorRequest).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason with the application id and reports the decision', async () => {
    const user = userEvent.setup();
    const { api, onClose, onDecided } = setup();
    await ready();
    await user.type(reasonField(), '  Deskripsi konten belum cukup jelas.  ');
    await user.click(confirmButton());
    await waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({ kind: 'rejected', response: REJECTED }),
    );
    expect(api.rejectCreatorRequest).toHaveBeenCalledTimes(1);
    expect(api.rejectCreatorRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      'Deskripsi konten belum cukup jelas.',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('fires once on a double click while pending and blocks Batal', async () => {
    const user = userEvent.setup();
    let release: (value: RejectCreatorRequestResponse) => void = () => {};
    const { api } = setup({
      reject: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    await ready();
    await user.type(reasonField(), 'Belum jelas.');
    await user.dblClick(confirmButton());
    expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
    expect(api.rejectCreatorRequest).toHaveBeenCalledTimes(1);
    release(REJECTED);
  });

  it('reports a request that somebody else decided first', async () => {
    const reject = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'CREATOR_REQUEST_ALREADY_REVIEWED', 'x', { status: 'APPROVED' }),
      );
    const { onDecided, onClose } = setup({ reject });
    await ready();
    await userEvent.type(reasonField(), 'Belum jelas.');
    await userEvent.click(confirmButton());
    await waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({ kind: 'already_reviewed', status: 'APPROVED' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps what was typed and shows a generic message when the call fails, then retries', async () => {
    const reject = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(REJECTED);
    const { onDecided } = setup({ reject });
    await ready();
    await userEvent.type(reasonField(), 'Belum jelas.');
    await userEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memproses. Coba lagi.');
    expect(reasonField()).toHaveValue('Belum jelas.');
    await userEvent.click(confirmButton());
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });

  it('checks the length before calling the server and says so inline', async () => {
    const { api, onDecided } = setup();
    await ready();
    await userEvent.click(reasonField());
    await userEvent.paste('a'.repeat(301));
    await userEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Alasan maksimal 300 karakter.');
    expect(api.rejectCreatorRequest).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('keeps the button inert while loading and after a failed load, and recovers on retry', async () => {
    const user = userEvent.setup();
    const get = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(review(LUNA));
    setup({ get });
    expect(confirmButton()).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Permintaan belum bisa dimuat.');
    await user.type(reasonField(), 'Belum jelas.');
    expect(confirmButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Coba Lagi' }));
    await ready();
    expect(confirmButton()).toBeEnabled();
  });
});
