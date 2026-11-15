import { NavLink } from 'react-router';
import type { NavEntry } from '../app/nav-config';
import styles from './BottomNav.module.css';

export interface BottomNavProps {
  items: readonly NavEntry[];
  /** Accessible name: "Navigasi utama" (customer) or "Navigasi creator". */
  label: string;
  /** Unread count shown on the first item; hidden for 0 / undefined, "99+" above 99. */
  unreadCount?: number;
  /** Forces which item looks active (previews); by default the router location decides. */
  current?: string;
}

export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Bottom navigation (Chats / CrInbox boards): 88 px, 24 px bottom padding or the safe area. */
export function BottomNav({ items, label, unreadCount, current }: BottomNavProps) {
  return (
    <nav aria-label={label} className={styles.nav}>
      {items.map(({ to, label: itemLabel, icon: Icon }, index) => {
        const badge = index === 0 && unreadCount && unreadCount > 0 ? unreadCount : null;
        return (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.item} ${(current === undefined ? isActive : current === to) ? styles.active : ''}`
            }
          >
            {({ isActive: routed }) => {
              const isActive = current === undefined ? routed : current === to;
              return (
                <>
                  {isActive ? <span aria-hidden="true" className={styles.bar} /> : null}
                  <span className={styles.icon}>
                    <Icon size={24} strokeWidth={isActive ? 2 : 1.75} />
                    {badge !== null ? (
                      <span className={styles.badge} aria-label={`${badge} pesan belum dibaca`}>
                        {formatBadge(badge)}
                      </span>
                    ) : null}
                  </span>
                  {itemLabel}
                </>
              );
            }}
          </NavLink>
        );
      })}
    </nav>
  );
}
