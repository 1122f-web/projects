import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { homePathFor, safeNext, useAuth } from '../../context/AuthContext';
import { EmptyState, PageLoader } from '../ui/Feedback';
import type { Role } from '../../lib/types';
import { hasAccess, type Access } from '../../lib/permissions';
import { AccountSuspended } from '../../pages/shared/AccountSuspended';

/**
 * Client-side route protection for a good user experience. The real
 * enforcement is on the backend and in database RLS policies.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, me, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!me) return <PageLoader />;
  if (me.account_status === 'suspended') return <AccountSuspended />;
  if (!roles.includes(me.role)) return <Navigate to={homePathFor(me.role)} replace />;
  return <>{children}</>;
}

/** Inside the admin area: staff see a page only with its permission. */
export function RequirePermission({ access, children }: { access: Access; children: ReactNode }) {
  const { me } = useAuth();
  if (!hasAccess(me, access)) {
    return (
      <EmptyState
        icon={Lock}
        title="You do not have access to this page"
        description="Ask an administrator to grant you this permission."
      />
    );
  }
  return <>{children}</>;
}

/** For login/register: signed-in users go to their dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, me, loading, recovering } = useAuth();
  const [params] = useSearchParams();
  if (loading) return <PageLoader />;
  if (session && me && !recovering) return <Navigate to={safeNext(params.get('next')) ?? homePathFor(me.role)} replace />;
  return <>{children}</>;
}

/** Sends notification links like /dashboard to the right role area. */
export function RoleHomeRedirect() {
  const { me, loading, session } = useAuth();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(me?.role)} replace />;
}
