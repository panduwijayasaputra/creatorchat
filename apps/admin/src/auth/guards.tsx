import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

interface FromState {
  from?: { pathname: string; search: string; hash: string };
}

/** Where to go after signing in: the page the person asked for, else the dashboard. */
export function destinationAfterLogin(state: unknown): string {
  const from = (state as FromState | null)?.from;
  if (!from || from.pathname === '/login') return '/';
  return `${from.pathname}${from.search}${from.hash}`;
}

/** Layout route for everything behind login. The shell never renders for an anonymous visitor. */
export function RequireAdmin() {
  const { state } = useAuth();
  const location = useLocation();
  // While the first `/me` is in flight show nothing: no flash of the shell, no flash of the login.
  if (state.status === 'loading') return null;
  if (state.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/** The login route: an already signed-in admin is sent on instead of seeing the form. */
export function RedirectIfAuthenticated() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return null;
  if (state.status === 'authenticated') {
    return <Navigate to={destinationAfterLogin(location.state)} replace />;
  }
  return <Outlet />;
}
