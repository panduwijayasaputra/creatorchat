import { Button, ChevronDownIcon, DotsIcon, XIcon } from '@creatorchat/ui';
import { Fragment } from 'react';
import { Link, useMatches } from 'react-router';
import { usePageCrumbsOverride } from './page-crumbs';
import { initialsOf, isRouteHandle, type AdminIdentity } from './route-handle';
import styles from './shell.module.css';

interface TopbarProps {
  admin: AdminIdentity;
  menuOpen: boolean;
  menuId: string;
  onToggleMenu: () => void;
  onLogout: () => void;
}

/** 84 px topbar: breadcrumb + page title, admin identity and Logout. */
export function Topbar({ admin, menuOpen, menuId, onToggleMenu, onLogout }: TopbarProps) {
  const handle = [...useMatches()].reverse().find((m) => isRouteHandle(m.handle))?.handle;
  const base = isRouteHandle(handle) ? handle : { title: 'Halaman', breadcrumb: [] };
  const override = usePageCrumbsOverride();
  const route = override ? { ...base, breadcrumb: override } : base;

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.menuButton}
        aria-label="Menu navigasi"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={onToggleMenu}
      >
        <DotsIcon size={20} strokeWidth={2} />
      </button>
      <div className={styles.heading}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          {route.breadcrumb.map((crumb, index) => (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? <span className={styles.crumbSep}>/</span> : null}
              {crumb.to ? (
                <Link to={crumb.to} className={styles.crumbLink}>
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className={styles.crumbCurrent}>
                  {crumb.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
        <h1 className={styles.title}>{route.title}</h1>
      </div>
      <Link to="/settings" aria-label={`Menu akun ${admin.name}`} className={styles.identity}>
        <span className={styles.avatar}>{initialsOf(admin.name)}</span>
        <span className={styles.identityText}>
          <span className={styles.identityName}>{admin.name}</span>
          <span className={styles.identityRole}>{admin.role}</span>
        </span>
        <ChevronDownIcon size={16} strokeWidth={2} />
      </Link>
      <Button
        variant="outline"
        className={styles.logoutTop}
        icon={<XIcon size={16} strokeWidth={2} />}
        onClick={onLogout}
      >
        Logout
      </Button>
    </header>
  );
}
