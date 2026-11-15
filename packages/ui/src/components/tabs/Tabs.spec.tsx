import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

const items = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'galeri', label: 'Galeri' },
];

function Harness() {
  const [value, setValue] = useState('ringkasan');
  return <Tabs label="Detail creator" items={items} value={value} onChange={setValue} />;
}

describe('Tabs', () => {
  it('marks exactly one tab selected and gives it the tab stop', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tablist', { name: 'Detail creator' })).toBeInTheDocument();
  });

  it('selects on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Galeri' }));
    expect(screen.getByRole('tab', { name: 'Galeri' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves with ArrowRight/ArrowLeft (wrapping), Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Ringkasan' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Subscriber' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Subscriber' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Galeri' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Galeri' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true');
  });
});
