import { createIcon } from './create-icon';

export type { IconProps } from './create-icon';

// Paths copied from the Claude Design boards (AdmMain, Main, CrMain, AdmTableStates, AdmDashTablet…).
export const HourglassIcon = createIcon(
  'Hourglass',
  <path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5v3.8L12 12l-4.5 4.7v3.8M16.5 3.5v3.8L12 12l4.5 4.7v3.8" />,
);
export const CheckCircleIcon = createIcon(
  'CheckCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.3l2.8 2.8L16 9.5" />
  </>,
);
export const UserSlashIcon = createIcon(
  'UserSlash',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6M3 3l18 18" />
  </>,
);
export const AlertCircleIcon = createIcon(
  'AlertCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </>,
);
export const ClockIcon = createIcon(
  'Clock',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const XIcon = createIcon('X', <path d="M6 6l12 12M18 6L6 18" />);
export const PlusIcon = createIcon('Plus', <path d="M12 5v14M5 12h14" />);
export const InfoCircleIcon = createIcon(
  'InfoCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </>,
);
export const EyeIcon = createIcon(
  'Eye',
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const ChevronRightIcon = createIcon('ChevronRight', <path d="M9 5l7 7-7 7" />);
export const ChevronLeftIcon = createIcon('ChevronLeft', <path d="M15 5l-7 7 7 7" />);
export const ChevronDownIcon = createIcon('ChevronDown', <path d="M7 10l5 5 5-5" />);
export const ChevronUpIcon = createIcon('ChevronUp', <path d="M7 14l5-5 5 5" />);
export const RefreshIcon = createIcon(
  'Refresh',
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 3.5v5h5" />
  </>,
);
export const SearchIcon = createIcon(
  'Search',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </>,
);
export const SendIcon = createIcon('Send', <path d="M21 3L10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" />);
export const CheckIcon = createIcon('Check', <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const ChatIcon = createIcon(
  'Chat',
  <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.5-4.9A8.5 8.5 0 1 1 21 12z" />,
);
export const CompassIcon = createIcon(
  'Compass',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.8 8.2l-2 5.6-5.6 2 2-5.6z" />
  </>,
);
export const BookmarkIcon = createIcon('Bookmark', <path d="M6.5 3.5h11v17.2L12 16.9l-5.5 3.8z" />);
export const UserIcon = createIcon(
  'User',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6" />
  </>,
);
export const UsersIcon = createIcon(
  'Users',
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.5-3.6 3.2-5.5 6.5-5.5s6 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.2 2.3 3.5 5.2" />
  </>,
);
export const ImageIcon = createIcon(
  'Image',
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M20.5 16l-4.5-4.5L7 19.5" />
  </>,
);
export const LockIcon = createIcon(
  'Lock',
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </>,
);
export const SparkleIcon = createIcon(
  'Sparkle',
  <path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9L12 18.1l-1.9-5.4L4.7 10.8l5.4-1.9z" />,
);
export const PencilIcon = createIcon(
  'Pencil',
  <>
    <path d="M4 20l4.2-1L19.4 7.8l-3.2-3.2L5 15.8z" />
    <path d="M14 6.8l3.2 3.2" />
  </>,
);
export const MegaphoneIcon = createIcon(
  'Megaphone',
  <>
    <path d="M3.5 10.5v3a1 1 0 0 0 1 1H7l8.5 4V5.5L7 9.5H4.5a1 1 0 0 0-1 1z" />
    <path d="M19 9a4.5 4.5 0 0 1 0 6" />
  </>,
);
export const SlidersIcon = createIcon(
  'Sliders',
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </>,
);
export const CalendarIcon = createIcon(
  'Calendar',
  <>
    <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
    <path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" />
  </>,
);
export const DotsIcon = createIcon(
  'Dots',
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
);
export const PlayIcon = createIcon('Play', <path d="M8 5.5v13l11-6.5z" />, { filled: true });
export const ArrowUpRightIcon = createIcon('ArrowUpRight', <path d="M7 17L17 7M9 7h8v8" />);
export const WifiIcon = createIcon(
  'Wifi',
  <path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9.2 16.4a4 4 0 0 1 5.6 0M12 20v.01" />,
);
export const UserOffIcon = createIcon(
  'UserOff',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6M3 3l18 18" />
  </>,
);
export const ShieldIcon = createIcon(
  'Shield',
  <path d="M12 3l7.5 2.8v5.7c0 4.6-3.2 7.9-7.5 9.5-4.3-1.6-7.5-4.9-7.5-9.5V5.8z" />,
);
export const HelpCircleIcon = createIcon(
  'HelpCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9M12 17v.01" />
  </>,
);
export const PaperclipIcon = createIcon(
  'Paperclip',
  <path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />,
);
export const UploadIcon = createIcon('Upload', <path d="M12 16V4.5M7 9.5l5-5 5 5M4.5 20h15" />);
export const CopyIcon = createIcon(
  'Copy',
  <>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" />
    <path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" />
  </>,
);
export const GlobeIcon = createIcon(
  'Globe',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.8 2.6 4 5.6 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.6-4-9s1.2-6.4 4-9z" />
  </>,
);
export const TrashIcon = createIcon('Trash', <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />);
