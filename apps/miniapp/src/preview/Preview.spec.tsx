import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Preview } from './Preview';

afterEach(cleanup);

describe('Mini App component preview', () => {
  it('renders every section, including both bottom navs', () => {
    const { container } = render(
      <MemoryRouter>
        <Preview />
      </MemoryRouter>,
    );
    const ids = Array.from(container.querySelectorAll('[data-preview-section]')).map((n) =>
      n.getAttribute('data-preview-section'),
    );
    for (const id of [
      'colors',
      'buttons',
      'inputs',
      'bottom-nav',
      'bottom-nav-customer',
      'bottom-nav-creator',
    ]) {
      expect(ids).toContain(id);
    }
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigasi creator' })).toBeInTheDocument();
    // customer + creator previews each show the fixture unread count of 2
    expect(screen.getAllByLabelText('2 pesan belum dibaca')).toHaveLength(2);
  });

  it('forces the active item visually without relying on the URL', () => {
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Preview />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    const chat = Array.from(nav.querySelectorAll('a')).find((a) => a.textContent?.includes('Chat'));
    const profile = Array.from(nav.querySelectorAll('a')).find((a) => a.textContent === 'Profil');
    expect(chat?.className).toContain('active');
    expect(profile?.className).not.toContain('active');
  });
});
