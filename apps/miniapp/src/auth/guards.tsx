import { Navigate, Outlet } from 'react-router';
import { landingPathForRole, type UserRole } from '@creatorchat/contracts';
import { useAuth } from './AuthProvider';
import { AuthGate } from './screens/AuthGate';

/**
 * Everything inside the shells needs a signed-in account. Until then the login screens (or the
 * connecting / error states) are shown instead of the route. This is a UX gate only: the API
 * enforces access on every request.
 */
export function RequireSession() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <AuthGate />;
  return <Outlet />;
}

/**
 * Keeps a role inside its own shell: a USER on a creator route goes to Chat, a CREATOR on a
 * customer route goes to Inbox. Convenience only: every endpoint checks the role on the server
 * (`@Roles()`), so skipping this gate would still be refused by the API.
 */
export function RequireRole({ role }: { role: UserRole }) {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  if (state.user.role !== role) {
    return <Navigate to={landingPathForRole(state.user.role)} replace />;
  }
  return <Outlet />;
}

/** `/` sends the signed-in account to its landing page; the role comes from `/me`. */
export function LandingRedirect() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return <Navigate to={landingPathForRole(state.user.role)} replace />;
}
