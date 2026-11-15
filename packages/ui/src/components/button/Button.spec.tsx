import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Button, type ButtonVariant } from './Button';

describe('Button', () => {
  it.each<ButtonVariant>(['primary', 'secondary', 'outline', 'danger', 'destructive', 'link'])(
    'renders the %s variant and calls onClick',
    async (variant) => {
      const onClick = vi.fn();
      render(
        <Button variant={variant} onClick={onClick}>
          Simpan
        </Button>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nonaktif
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores clicks while loading and exposes aria-busy', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Logout
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Logout' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activates with Enter and Space', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Kirim</Button>);
    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('renders the icon before the label', () => {
    render(<Button icon={<svg data-testid="i" />}>Reset Filter</Button>);
    const button = screen.getByRole('button');
    expect(button.firstElementChild).toBe(screen.getByTestId('i'));
  });
});

describe('Button styles', () => {
  const css = readFileSync(resolve(import.meta.dirname, 'Button.module.css'), 'utf8');

  it('never wraps its label', () => {
    expect(css).toMatch(/\.button\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('uses the control heights from the tokens', () => {
    expect(css).toMatch(/\.table\s*\{[^}]*var\(--h-button-table\)/);
    expect(css).toMatch(/\.md\s*\{[^}]*var\(--h-button\)/);
  });
});
