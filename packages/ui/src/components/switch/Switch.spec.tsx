import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

afterEach(cleanup);

describe('Switch', () => {
  it('exposes role=switch with its name and state', () => {
    render(<Switch checked label="Notifikasi pesan" />);
    expect(screen.getByRole('switch', { name: 'Notifikasi pesan' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('asks for the opposite value when toggled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="x" onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a disabled switch cannot be toggled', async () => {
    const onChange = vi.fn();
    render(<Switch checked label="x" disabled onChange={onChange} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
