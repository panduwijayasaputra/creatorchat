import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { CREATOR_NAV, CUSTOMER_NAV } from '../app/nav-config';
import { BottomNav, formatBadge } from './BottomNav';

afterEach(cleanup);

function renderNav(props: Parameters<typeof BottomNav>[0], path = '/chats') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav {...props} />
    </MemoryRouter>,
  );
}

describe('BottomNav', () => {
  it('shows exactly Chat, Jelajahi, Langganan, Profil for customers', () => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama' });
    const links = within(screen.getByRole('navigation', { name: 'Navigasi utama' })).getAllByRole(
      'link',
    );
    expect(links.map((l) => l.textContent)).toEqual(['Chat', 'Jelajahi', 'Langganan', 'Profil']);
  });

  it('shows exactly Inbox, Galeri, Broadcast, Pengaturan for creators', () => {
    renderNav({ items: CREATOR_NAV, label: 'Navigasi creator' }, '/inbox');
    const links = within(screen.getByRole('navigation', { name: 'Navigasi creator' })).getAllByRole(
      'link',
    );
    expect(links.map((l) => l.textContent)).toEqual(['Inbox', 'Galeri', 'Broadcast', 'Pengaturan']);
  });

  it('marks exactly one item as the current page, following the route', () => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama' }, '/explore');
    const current = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Jelajahi');
  });

  it('keeps a tab active on nested paths (e.g. an open conversation)', () => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama' }, '/chats/abc');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  });

  it('has no role switcher and no cross-role entry', () => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama' });
    expect(screen.queryByText(/switch|ganti role|mode/i)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Inbox' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('BottomNav unread badge', () => {
  it.each([undefined, 0])('is hidden for %s', (count) => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama', unreadCount: count });
    expect(screen.queryByLabelText(/pesan belum dibaca/)).toBeNull();
  });

  it('shows the count with an Indonesian accessible label on the first item only', () => {
    renderNav({ items: CUSTOMER_NAV, label: 'Navigasi utama', unreadCount: 2 });
    const badge = screen.getByLabelText('2 pesan belum dibaca');
    expect(badge).toHaveTextContent('2');
    expect(
      within(screen.getByRole('link', { name: /Chat/ })).getByLabelText('2 pesan belum dibaca'),
    ).toBe(badge);
    expect(screen.getAllByLabelText(/pesan belum dibaca/)).toHaveLength(1);
  });

  it('caps at 99+', () => {
    expect(formatBadge(99)).toBe('99');
    expect(formatBadge(100)).toBe('99+');
    renderNav({ items: CREATOR_NAV, label: 'Navigasi creator', unreadCount: 250 });
    expect(screen.getByLabelText('250 pesan belum dibaca')).toHaveTextContent('99+');
  });
});

describe('BottomNav styles', () => {
  const css = readFileSync(resolve(import.meta.dirname, 'BottomNav.module.css'), 'utf8');

  it('reserves the safe area below the items but never less than 24 px', () => {
    expect(css).toMatch(/padding:\s*8px 8px max\(24px, var\(--safe-bottom\)\)/);
  });

  it('is 88 px tall including the border, growing with the safe area', () => {
    expect(css).toContain('height: calc(64px + max(24px, var(--safe-bottom)));');
  });

  it('keeps labels on one line and touch targets at least 44 px wide', () => {
    expect(css).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/min-width:\s*var\(--touch-min\)/);
  });
});
