import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = [
  { value: '', label: 'Semua' },
  { value: 'active', label: 'Active' },
];

describe('Select', () => {
  it('shows the prefix label and the selected option', () => {
    render(<Select label="Status" value="" options={options} onChange={() => {}} />);
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
    expect(screen.getByText('Semua', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });

  it('calls onChange with the chosen value', async () => {
    const onChange = vi.fn();
    render(<Select label="Status" value="" options={options} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('can hide the prefix but keep the accessible name', () => {
    render(
      <Select label="Baris per halaman" hideLabel value="" options={options} onChange={() => {}} />,
    );
    expect(screen.queryByText('Baris per halaman:')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Baris per halaman' })).toBeInTheDocument();
  });
});
