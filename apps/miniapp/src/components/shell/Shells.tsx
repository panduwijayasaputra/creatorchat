import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { CREATOR_NAV, CUSTOMER_NAV } from '../../app/nav-config';
import { useUnread } from '../../chats/UnreadProvider';
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
  // The prop overrides the live count (tests); otherwise the badge shows the server's total.
  const live = useUnread();
  return (
    <Frame
      nav={
        <BottomNav label="Navigasi utama" items={CUSTOMER_NAV} unreadCount={unreadCount ?? live} />
      }
    />
  );
}

export function CreatorShell({ unreadCount }: ShellProps) {
  // The Inbox badge counts conversations with unread customer messages (CrInbox board).
  const live = useUnread();
  return (
    <Frame
      nav={
        <BottomNav
          label="Navigasi creator"
          items={CREATOR_NAV}
          unreadCount={unreadCount ?? live}
          badgeLabel={(n) => `${n} percakapan belum dibaca`}
        />
      }
    />
  );
}

/**
 * The customer frame (bottom navigation) around a page that is not a child route of the shell: the
 * creator profile keeps its own route so a CREATOR following a link still gets the explanation page.
 */
export function CustomerFrame({ children, unreadCount }: ShellProps & { children: ReactNode }) {
  const live = useUnread();
  return (
    <div className={styles.frame}>
      <main className={styles.content}>{children}</main>
      <BottomNav label="Navigasi utama" items={CUSTOMER_NAV} unreadCount={unreadCount ?? live} />
    </div>
  );
}
