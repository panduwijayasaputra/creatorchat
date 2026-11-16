import { Outlet, type RouteObject } from 'react-router';
import { AuthProvider, type SeenFlag } from '../auth/AuthProvider';
import type { MiniappApi } from '../auth/api-client';
import { LandingRedirect, RequireRole, RequireSession } from '../auth/guards';
import type { TelegramEnv } from '../telegram/webapp';
import { CreatorLinkPage } from '../creator-link/CreatorLinkPage';
import { HealthStatus } from '../components/HealthStatus';
import { NotImplemented } from '../components/NotImplemented';
import { CreatorEditProfilePage } from '../creator/CreatorEditProfilePage';
import { CreatorSettingsPage } from '../creator/CreatorSettingsPage';
import { CreatorTimezonePage } from '../creator/CreatorTimezonePage';
import { CreatorRequestPage, REQUEST_STATUS_PATH } from '../profile/CreatorRequestPage';
import { EditProfilePage } from '../profile/EditProfilePage';
import { ProfilePage } from '../profile/ProfilePage';
import { CreatorShell, CustomerShell } from '../components/shell/Shells';
import { CREATOR_NAV, CUSTOMER_NAV, type NavEntry } from './nav-config';

export interface MiniappRoutesOptions {
  /** The Mini App API client (token in memory). */
  api: MiniappApi;
  /** Test seams for Telegram and the "seen before" device hint. */
  telegram?: TelegramEnv;
  seen?: SeenFlag;
  /** No data source yet: the chat stories feed the real unread count. */
  unreadCount?: number;
  /** Extra routes outside the shells (e.g. the dev-only component preview). */
  extraRoutes?: RouteObject[];
}

/** Settings rows whose screens belong to later stories. */
const LATER_SETTINGS = [
  ['persona', 'Persona AI'],
  ['welcome', 'Pesan selamat datang'],
  ['price', 'Harga subscription'],
] as const;

function placeholder(entry: NavEntry, withHealth = false): RouteObject {
  return {
    path: entry.to.slice(1),
    element: (
      <NotImplemented title={entry.label}>{withHealth ? <HealthStatus /> : null}</NotImplemented>
    ),
  };
}

/**
 * Everything except the dev-only preview needs a signed-in account (US-004). `/` lands USER on Chat
 * and CREATOR on Inbox from the server's `/me`. Each shell is role-gated (US-006): a wrong-role URL
 * redirects to the account's own landing. This is a UX gate; the API enforces roles on every request.
 */
export function createMiniappRoutes({
  api,
  telegram,
  seen,
  unreadCount,
  extraRoutes = [],
}: MiniappRoutesOptions): RouteObject[] {
  return [
    {
      element: (
        <AuthProvider api={api} {...(telegram ? { telegram } : {})} {...(seen ? { seen } : {})}>
          <Outlet />
        </AuthProvider>
      ),
      children: [
        {
          element: <RequireSession />,
          children: [
            { path: '/', element: <LandingRedirect /> },
            // Deep-link landing (US-005): the path survives login; the server resolves the code.
            { path: '/creators/:publicCode', element: <CreatorLinkPage api={api} /> },
            {
              element: <RequireRole role="USER" />,
              children: [
                {
                  element: <CustomerShell unreadCount={unreadCount} />,
                  children: [
                    // Profile is real (US-007); the other customer tabs are still placeholders.
                    ...CUSTOMER_NAV.flatMap((entry, index) =>
                      entry.to === '/profile' ? [] : [placeholder(entry, index === 0)],
                    ),
                    { path: 'profile', element: <ProfilePage api={api} /> },
                  ],
                },
                // Full-screen pages under Profil (no bottom navigation).
                {
                  path: 'profile/edit',
                  element: <EditProfilePage />,
                },
                { path: 'profile/creator-request', element: <CreatorRequestPage api={api} /> },
                {
                  // US-011 builds the status screen; a submitted or pending request lands here.
                  path: REQUEST_STATUS_PATH.slice(1),
                  element: <NotImplemented title="Status permintaan" />,
                },
              ],
            },
            {
              element: <RequireRole role="CREATOR" />,
              children: [
                {
                  element: <CreatorShell unreadCount={unreadCount} />,
                  children: [
                    // Settings is real (US-008); the other creator tabs are still placeholders.
                    ...CREATOR_NAV.filter((entry) => entry.to !== '/settings').map((entry) =>
                      placeholder(entry),
                    ),
                    { path: 'settings', element: <CreatorSettingsPage api={api} /> },
                    // Rows owned by later stories (persona, welcome message, price).
                    ...LATER_SETTINGS.map(([path, title]) => ({
                      path: `settings/${path}`,
                      element: <NotImplemented title={title} />,
                    })),
                  ],
                },
                // Full-screen page under Pengaturan (no bottom navigation).
                { path: 'settings/profile', element: <CreatorEditProfilePage /> },
                { path: 'settings/timezone', element: <CreatorTimezonePage /> },
              ],
            },
            {
              path: '*',
              element: (
                <main>
                  <NotImplemented title="Halaman tidak ditemukan" />
                </main>
              ),
            },
          ],
        },
      ],
    },
    // Dev-only routes (the component preview) stay outside the auth gate.
    ...extraRoutes,
  ];
}
