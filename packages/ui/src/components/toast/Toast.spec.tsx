import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastOptions } from './ToastProvider';

function Trigger({ options }: { options: ToastOptions }) {
  const { show } = useToast();
  return <button onClick={() => show(options)}>tampil {options.message}</button>;
}

function setup(options: ToastOptions[]) {
  render(
    <ToastProvider>
      {options.map((o) => (
        <Trigger key={o.message} options={o} />
      ))}
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('uses role=status for success and role=alert for errors', async () => {
    setup([{ message: 'Berhasil disimpan' }, { kind: 'error', message: 'Gagal menyimpan' }]);
    await userEvent.click(screen.getByText('tampil Berhasil disimpan'));
    await userEvent.click(screen.getByText('tampil Gagal menyimpan'));
    expect(screen.getByRole('status')).toHaveTextContent('Berhasil disimpan');
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan');
  });

  it('auto-dismisses after the duration', async () => {
    setup([{ message: 'Halo', duration: 1000 }]);
    await userEvent.click(screen.getByText('tampil Halo'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('pauses auto-dismiss while hovered and resumes after', async () => {
    setup([{ message: 'Halo', duration: 1000 }]);
    await userEvent.click(screen.getByText('tampil Halo'));
    const toast = screen.getByRole('status');
    await userEvent.hover(toast);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await userEvent.unhover(toast);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows at most 3 toasts, dropping the oldest', async () => {
    const msgs = ['a', 'b', 'c', 'd'].map((m) => ({ message: m, duration: 60000 }));
    setup(msgs);
    for (const m of msgs) await userEvent.click(screen.getByText(`tampil ${m.message}`));
    const shown = screen.getAllByRole('status').map((t) => t.textContent);
    expect(shown).toEqual(['b', 'c', 'd']);
  });

  it('throws a clear error when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger options={{ message: 'x' }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
