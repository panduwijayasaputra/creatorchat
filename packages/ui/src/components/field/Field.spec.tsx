import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';
import { PasswordInput } from './PasswordInput';
import { SearchInput } from './SearchInput';
import { TextInput } from './TextInput';

describe('Field', () => {
  it('associates the label with the control', () => {
    render(
      <Field label="Username">
        <TextInput />
      </Field>,
    );
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('announces the error and marks the control invalid', () => {
    render(
      <Field label="Username" error="Wajib diisi" hint="Huruf kecil">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText('Username');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Wajib diisi');
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(input).toHaveAccessibleDescription('Wajib diisi Huruf kecil');
  });

  it('is not invalid without an error', () => {
    render(
      <Field label="Username">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText('Username');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('PasswordInput', () => {
  it('hides the value by default and toggles with "Tampilkan"', async () => {
    render(
      <Field label="Password">
        <PasswordInput defaultValue="rahasia123" />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('rahasia123');
    expect(screen.getByRole('button', { name: 'Sembunyikan password' })).toHaveTextContent(
      'Sembunyikan',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan password' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('rahasia123');
  });

  it('has a toggle reachable by keyboard', async () => {
    render(<PasswordInput aria-label="Password" />);
    await userEvent.tab(); // input
    await userEvent.tab(); // toggle
    expect(screen.getByRole('button', { name: 'Tampilkan password' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('passes autoComplete through', () => {
    render(<PasswordInput aria-label="Password" autoComplete="current-password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('never submits a surrounding form from the toggle', async () => {
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <PasswordInput aria-label="Password" />
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan password' }));
    expect(submitted).toBe(false);
  });
});

describe('SearchInput', () => {
  it('renders a search box with the given accessible name', async () => {
    render(<SearchInput aria-label="Cari" placeholder="Cari nama atau Telegram ID" />);
    const input = screen.getByRole('searchbox', { name: 'Cari' });
    await userEvent.type(input, 'zzz');
    expect(input).toHaveValue('zzz');
  });
});
