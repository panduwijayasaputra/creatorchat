import {
  ClockIcon,
  CompassIcon,
  SlidersIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from '@creatorchat/ui';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Match the path exactly (only the dashboard root). */
  end?: boolean;
}

/** Sidebar order from the admin boards (AdmDashboard). */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: CompassIcon, end: true },
  { to: '/creators', label: 'Creator', icon: UsersIcon },
  { to: '/users', label: 'User', icon: UserIcon },
  { to: '/logs', label: 'Log & History', icon: ClockIcon },
  { to: '/ai', label: 'AI', icon: SparkleIcon },
  { to: '/settings', label: 'Pengaturan', icon: SlidersIcon },
];
