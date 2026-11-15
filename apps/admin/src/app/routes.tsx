import type { ReactElement } from 'react';
import { Outlet, type RouteObject } from 'react-router';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import type { AdminApi } from '../auth/api-client';
import { RedirectIfAuthenticated, RequireAdmin } from '../auth/guards';
import { HealthStatus } from '../components/HealthStatus';
import { NotImplemented } from '../components/NotImplemented';
import { AdminShell } from '../components/shell/AdminShell';
import type { RouteHandle } from '../components/shell/route-handle';
import { LoginPage } from '../pages/login/LoginPage';

export interface AdminRoutesOptions {
  /** The admin API client. Defaults to the real one (same-origin `/v1/admin`). */
  api?: AdminApi;
  /** Extra top-level routes outside auth and the shell (e.g. the dev-only component preview). */
  extraRoutes?: RouteObject[];
}

const home = { label: 'Dashboard', to: '/' } as const;

function page(path: string, title: string): RouteObject {
  const handle: RouteHandle = { title, breadcrumb: [home, { label: title }] };
  return { path, handle, element: <NotImplemented /> };
}

/** The shell with the signed-in admin and the real logout (the dialog shows failures itself). */
function AuthenticatedShell(): ReactElement {
  const { state, logout } = useAuth();
  const admin = state.status === 'authenticated' ? state.admin : null;
  return (
    <AdminShell
      admin={{ name: admin?.username ?? '', role: admin?.role ?? '' }}
      onLogout={logout}
    />
  );
}

/** Hosts the session state for every route below it. */
function AuthRoot({ api }: { api: AdminApi | undefined }): ReactElement {
  return (
    <AuthProvider {...(api ? { api } : {})}>
      <Outlet />
    </AuthProvider>
  );
}

/** `/login` is public; everything else needs a signed-in admin. Real screens replace placeholders. */
export function createAdminRoutes({
  api,
  extraRoutes = [],
}: AdminRoutesOptions = {}): RouteObject[] {
  const dashboard: RouteHandle = { title: 'Dashboard', breadcrumb: [{ label: 'Dashboard' }] };
  return [
    ...extraRoutes,
    {
      element: <AuthRoot api={api} />,
      children: [
        {
          element: <RedirectIfAuthenticated />,
          children: [{ path: 'login', element: <LoginPage /> }],
        },
        {
          element: <RequireAdmin />,
          children: [
            {
              path: '/',
              element: <AuthenticatedShell />,
              children: [
                {
                  index: true,
                  handle: dashboard,
                  element: (
                    <NotImplemented>
                      <HealthStatus />
                    </NotImplemented>
                  ),
                },
                page('creators', 'Creator'),
                page('users', 'User'),
                page('logs', 'Log & History'),
                page('ai', 'AI'),
                page('settings', 'Pengaturan'),
                {
                  path: '*',
                  handle: {
                    title: 'Halaman tidak ditemukan',
                    breadcrumb: [home, { label: 'Tidak ditemukan' }],
                  },
                  element: <NotImplemented />,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}
