import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as icons from './index';

const all = Object.entries(icons).filter(([name]) => name.endsWith('Icon')) as [
  string,
  (typeof icons)['XIcon'],
][];

describe('icons', () => {
  it('exports a non-trivial icon set', () => {
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  it.each(all)('%s is decorative by default', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('gets an accessible name when a title is given', () => {
    const { getByRole } = render(<icons.EyeIcon title="Lihat" />);
    expect(getByRole('img', { name: 'Lihat' })).toBeInTheDocument();
  });

  it('honours size and strokeWidth', () => {
    const { container } = render(<icons.ChatIcon size={22} strokeWidth={2} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('22');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
  });
});
