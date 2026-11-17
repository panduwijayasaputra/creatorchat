import { useEffect, useId, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { LogoutDialog } from './LogoutDialog';
import { MobileMenu } from './MobileMenu';
import { PageCrumbsProvider } from './page-crumbs';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import type { AdminIdentity } from './route-handle';
import styles from './shell.module.css';

export interface AdminShellProps {
  admin: AdminIdentity;
  /** Runs when the admin confirms Logout. The real call arrives with US-003. */
  onLogout: () => Promise<void> | void;
}

/** Layout route: sidebar (or rail, or mobile menu) + topbar + the routed page. */
export function AdminShell({ admin, onLogout }: AdminShellProps) {
  const menuId = useId();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  // The menu closes on navigation and on Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const askLogout = () => {
    setMenuOpen(false);
    setLogoutOpen(true);
  };

  return (
    <PageCrumbsProvider>
      <div className={styles.shell}>
        <a href="#main" className={styles.skip}>
          Lewati ke konten
        </a>
        <Sidebar />
        <div className={styles.column}>
          <Topbar
            admin={admin}
            menuOpen={menuOpen}
            menuId={menuId}
            onToggleMenu={() => setMenuOpen((open) => !open)}
            onLogout={askLogout}
          />
          {menuOpen ? <MobileMenu id={menuId} onLogout={askLogout} /> : null}
          <main id="main" className={styles.main}>
            <Outlet />
          </main>
        </div>
        <LogoutDialog open={logoutOpen} onConfirm={onLogout} onClose={() => setLogoutOpen(false)} />
      </div>
    </PageCrumbsProvider>
  );
}
