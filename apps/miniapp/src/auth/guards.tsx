import { Navigate, Outlet } from 'react-router';
import { landingPathForRole } from '@creatorchat/contracts';
import { useAuth } from './AuthProvider';
import { AuthGate } from './screens/AuthGate';

/**
 * Everything inside the shells needs a signed-in account. Until then the login screens (or the
 * connecting / error states) are shown instead of the route. This is a UX gate only: the API
 * enforces access on every request (role enforcement itself arrives with US-006).
 */
export function RequireSession() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <AuthGate />;
  return <Outlet />;
}

/** `/` sends the signed-in account to its landing page; the role comes from `/me`. */
export function LandingRedirect() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return <Navigate to={landingPathForRole(state.user.role)} replace />;
}
