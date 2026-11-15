import { Outlet, type RouteObject } from 'react-router';
import { AuthProvider, type SeenFlag } from '../auth/AuthProvider';
import type { MiniappApi } from '../auth/api-client';
import { LandingRedirect, RequireSession } from '../auth/guards';
import type { TelegramEnv } from '../telegram/webapp';
import { HealthStatus } from '../components/HealthStatus';
import { NotImplemented } from '../components/NotImplemented';
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
 * and CREATOR on Inbox from the server's `/me`; the shells themselves are not yet role-gated
 * (US-006), so a wrong-role URL still renders its shell.
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
            {
              element: <CustomerShell unreadCount={unreadCount} />,
              children: CUSTOMER_NAV.map((entry, index) => placeholder(entry, index === 0)),
            },
            {
              element: <CreatorShell unreadCount={unreadCount} />,
              children: CREATOR_NAV.map((entry) => placeholder(entry)),
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
