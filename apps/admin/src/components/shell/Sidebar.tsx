import { ChatIcon } from '@creatorchat/ui';
import { NavLink } from 'react-router';
import { NAV_ITEMS } from '../../app/nav';
import styles from './shell.module.css';

/** 248 px sidebar; collapses to an 80 px icon rail below 1280 px (CSS only). */
export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <ChatIcon size={20} strokeWidth={2} />
        </span>
        <div className={styles.brandText}>
          <div className={styles.brandName}>Creator Chat</div>
          <div className={styles.brandSub}>Admin</div>
        </div>
      </div>
      <nav aria-label="Menu admin" className={styles.nav}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            title={label}
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
    </aside>
  );
}
