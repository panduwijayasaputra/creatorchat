import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('shows the illustration when there is no photo', () => {
    render(<Avatar src={null} />);
    expect(screen.getByTestId('avatar-placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the photo as an image with the given size and alt', () => {
    render(<Avatar src="https://t.me/i/a.jpg" size={96} alt="Maya" />);
    const img = screen.getByRole('img', { name: 'Maya' });
    expect(img).toHaveAttribute('src', 'https://t.me/i/a.jpg');
    expect(img.parentElement).toHaveStyle({ width: '96px', height: '96px' });
  });

  it('falls back to the illustration when the photo fails to load, and retries a new URL', () => {
    const { rerender } = render(<Avatar src="https://t.me/i/a.jpg" alt="Maya" />);
    fireEvent.error(screen.getByRole('img', { name: 'Maya' }));
    expect(screen.getByTestId('avatar-placeholder')).toBeInTheDocument();
    rerender(<Avatar src="https://t.me/i/b.jpg" alt="Maya" />);
    expect(screen.getByRole('img', { name: 'Maya' })).toHaveAttribute(
      'src',
      'https://t.me/i/b.jpg',
    );
  });
});
