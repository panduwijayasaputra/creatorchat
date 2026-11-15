import {
  BookmarkIcon,
  ChatIcon,
  CompassIcon,
  ImageIcon,
  MegaphoneIcon,
  SlidersIcon,
  UserIcon,
  type IconProps,
} from '@creatorchat/ui';
import type { ComponentType } from 'react';

export interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
}

/** USER tabs (Chats board). */
export const CUSTOMER_NAV: readonly NavEntry[] = [
  { to: '/chats', label: 'Chat', icon: ChatIcon },
  { to: '/explore', label: 'Jelajahi', icon: CompassIcon },
  { to: '/subscriptions', label: 'Langganan', icon: BookmarkIcon },
  { to: '/profile', label: 'Profil', icon: UserIcon },
];

/** CREATOR tabs (CrInbox board). The unread badge belongs to the first tab. */
export const CREATOR_NAV: readonly NavEntry[] = [
  { to: '/inbox', label: 'Inbox', icon: ChatIcon },
  { to: '/gallery', label: 'Galeri', icon: ImageIcon },
  { to: '/broadcast', label: 'Broadcast', icon: MegaphoneIcon },
  { to: '/settings', label: 'Pengaturan', icon: SlidersIcon },
];
