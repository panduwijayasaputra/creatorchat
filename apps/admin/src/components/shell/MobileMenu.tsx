import { Button, XIcon } from '@creatorchat/ui';
import { NavLink } from 'react-router';
import { NAV_ITEMS } from '../../app/nav';
import styles from './shell.module.css';

/**
 * Menu behind the "…" button below 768 px. Design gap: the boards show the button but not the
 * opened menu, so this reuses the sidebar item styling (see the US-002 QA report).
 */
export function MobileMenu({ id, onLogout }: { id: string; onLogout: () => void }) {
  return (
    <div id={id} className={styles.mobileMenu}>
      <nav aria-label="Menu admin mobile" className={styles.nav}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
          >
            {({ isActive }) => (
              <>
                {isActive ? <span aria-hidden="true" className={styles.activeBar} /> : null}
                <Icon size={22} strokeWidth={isActive ? 2 : 1.75} />
                <span className={styles.navLabel}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <Button
        variant="outline"
        fullWidth
        icon={<XIcon size={16} strokeWidth={2} />}
        onClick={onLogout}
      >
        Logout
      </Button>
    </div>
  );
}
