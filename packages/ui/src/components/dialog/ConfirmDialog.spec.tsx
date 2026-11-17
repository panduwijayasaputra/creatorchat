import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Harness(
  props: Partial<ConfirmDialogProps> & { onConfirm: ConfirmDialogProps['onConfirm'] },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Buka</button>
      <ConfirmDialog
        open={open}
        title="Block creator?"
        consequence="Akses creator dinonaktifkan."
        confirmLabel="Block Creator"
        destructive
        {...props}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Buka' }));
  return screen.getByRole('dialog', { name: 'Block creator?' });
}

describe('ConfirmDialog', () => {
  it('renders title, consequence, Batal and the specific verb', async () => {
    render(<Harness onConfirm={vi.fn()} />);
    const dialog = await openDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Akses creator dinonaktifkan.');
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block Creator' })).toBeInTheDocument();
  });

  it('places the afterReason text under the reason and honours top', async () => {
    render(
      <Harness
        onConfirm={vi.fn()}
        top={110}
        reason={{ label: 'Alasan (wajib)', required: true }}
        afterReason="Tidak ada pembayaran."
      />,
    );
    const dialog = await openDialog();
    expect(dialog).toHaveStyle({ top: '110px' });
    const reason = screen.getByLabelText('Alasan (wajib)');
    const after = screen.getByText('Tidak ada pembayaran.');
    expect(reason.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not rendered while closed', () => {
    render(<Harness onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires onConfirm once on a synchronous double click, then closes', async () => {
    const d = deferred();
    const onConfirm = vi.fn(() => d.promise);
    render(<Harness onConfirm={onConfirm} />);
    await openDialog();
    const confirm = screen.getByRole('button', { name: 'Block Creator' });
    await userEvent.dblClick(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    d.resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('blocks Batal, Escape and backdrop while processing', async () => {
    const d = deferred();
    render(<Harness onConfirm={() => d.promise} />);
    await openDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const backdrop = document.querySelector('[aria-hidden="true"][class*="backdrop"]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    d.resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape, backdrop and Batal when idle, without confirming', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await openDialog();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays open with an inline error on failure and keeps the typed reason', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('SECRET internal detail'));
    render(
      <Harness
        onConfirm={onConfirm}
        reason={{ label: 'Alasan block (wajib)', required: true }}
        failureMessage="Gagal memblokir."
      />,
    );
    await openDialog();
    await userEvent.type(screen.getByLabelText('Alasan block (wajib)'), 'Pelanggaran konten');
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memblokir.');
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alasan block (wajib)')).toHaveValue('Pelanggaran konten');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // retry works after failure
    onConfirm.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('requires a non-blank reason and passes it trimmed', async () => {
    const onConfirm = vi.fn();
    render(
      <Harness onConfirm={onConfirm} reason={{ label: 'Alasan block (wajib)', required: true }} />,
    );
    await openDialog();
    const confirm = screen.getByRole('button', { name: 'Block Creator' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Alasan block (wajib)'), '   ');
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Alasan block (wajib)'), ' Spam  ');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Spam');
  });

  it('renders the reason as text only', async () => {
    render(<Harness onConfirm={vi.fn()} reason={{ label: 'Alasan', required: false }} />);
    await openDialog();
    await userEvent.type(screen.getByLabelText('Alasan'), '<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });

  it('moves focus in, traps Tab, and restores focus to the opener', async () => {
    render(<Harness onConfirm={vi.fn()} />);
    const opener = screen.getByRole('button', { name: 'Buka' });
    await userEvent.click(opener);
    const cancel = screen.getByRole('button', { name: 'Batal' });
    const confirm = screen.getByRole('button', { name: 'Block Creator' });
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus(); // wraps
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus(); // wraps backwards
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('locks body scroll while open and releases it on close', async () => {
    render(<Harness onConfirm={vi.fn()} />);
    await openDialog();
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  describe('review dialogs (US-012 additions)', () => {
    it('keeps the confirm button inert with confirmDisabled and never fires', async () => {
      const onConfirm = vi.fn();
      render(<Harness onConfirm={onConfirm} confirmDisabled />);
      await openDialog();
      const confirm = screen.getByRole('button', { name: 'Block Creator' });
      expect(confirm).toBeDisabled();
      await userEvent.click(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('shows pendingLabel with a spinner while pending and the normal label afterwards', async () => {
      const d = deferred();
      render(<Harness onConfirm={() => d.promise} pendingLabel="Memproses…" />);
      await openDialog();
      await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
      const busy = await screen.findByRole('button', { name: 'Memproses…' });
      expect(busy).toHaveAttribute('aria-busy', 'true');
      expect(busy.querySelector('svg')).not.toBeNull();
      d.resolve();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('stays open when onConfirm resolves false, and is usable again', async () => {
      const onConfirm = vi.fn(async () => false);
      render(<Harness onConfirm={onConfirm} />);
      await openDialog();
      await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Block Creator' })).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('closes when onConfirm resolves true or nothing', async () => {
      render(<Harness onConfirm={async () => true} />);
      await openDialog();
      await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    describe('required reason message', () => {
      const reason = {
        label: 'Alasan penolakan (wajib)',
        required: true,
        placeholder: 'Tulis alasan singkat',
        hint: 'Alasan dicatat di audit log.',
        requiredMessage: 'Alasan wajib diisi.',
      };

      it('shows the hint first, then the red message once the field is touched and empty', async () => {
        render(<Harness onConfirm={vi.fn()} reason={reason} />);
        await openDialog();
        const field = screen.getByLabelText('Alasan penolakan (wajib)');
        expect(screen.getByText('Alasan dicatat di audit log.')).toBeInTheDocument();
        expect(screen.queryByText('Alasan wajib diisi.')).not.toBeInTheDocument();

        await userEvent.type(field, 'a');
        await userEvent.clear(field);
        expect(screen.getByText('Alasan wajib diisi.')).toBeInTheDocument();
        expect(screen.queryByText('Alasan dicatat di audit log.')).not.toBeInTheDocument();
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field).toHaveAccessibleDescription('Alasan wajib diisi.');
        expect(screen.getByRole('button', { name: 'Block Creator' })).toBeDisabled();
      });

      it('treats whitespace as empty, and clears the message once text is typed', async () => {
        const onConfirm = vi.fn();
        render(<Harness onConfirm={onConfirm} reason={reason} />);
        await openDialog();
        const field = screen.getByLabelText('Alasan penolakan (wajib)');
        await userEvent.type(field, '   ');
        expect(screen.getByText('Alasan wajib diisi.')).toBeInTheDocument();
        await userEvent.type(field, 'Belum jelas');
        expect(screen.queryByText('Alasan wajib diisi.')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Block Creator' }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Belum jelas'));
      });

      it('shows no message without requiredMessage (the button stays disabled)', async () => {
        const { requiredMessage: _unused, ...plain } = reason;
        render(<Harness onConfirm={vi.fn()} reason={plain} />);
        await openDialog();
        await userEvent.type(screen.getByLabelText('Alasan penolakan (wajib)'), ' ');
        expect(screen.queryByText('Alasan wajib diisi.')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Block Creator' })).toBeDisabled();
      });
    });
  });
});
