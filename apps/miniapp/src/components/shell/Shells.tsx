import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { CREATOR_NAV, CUSTOMER_NAV } from '../../app/nav-config';
import { BottomNav } from '../BottomNav';
import styles from './shell.module.css';

interface ShellProps {
  unreadCount?: number;
}

/**
 * The Mini App draws no header (Telegram's native one is used). Content scrolls inside; the
 * bottom navigation stays put. There is no role switcher: the shell is chosen by the route group.
 */
function Frame({ nav }: { nav: ReactNode }) {
  return (
    <div className={styles.frame}>
      <main className={styles.content}>
        <Outlet />
      </main>
      {nav}
    </div>
  );
}

export function CustomerShell({ unreadCount }: ShellProps) {
  return (
    <Frame
      nav={<BottomNav label="Navigasi utama" items={CUSTOMER_NAV} unreadCount={unreadCount} />}
    />
  );
}

export function CreatorShell({ unreadCount }: ShellProps) {
  return (
    <Frame
      nav={<BottomNav label="Navigasi creator" items={CREATOR_NAV} unreadCount={unreadCount} />}
    />
  );
}
