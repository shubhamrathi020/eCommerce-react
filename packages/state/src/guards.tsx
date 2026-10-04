import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useService, useSignal } from '@shop/core';
import { AuthStore } from './auth.store';

function useAuthReady() {
  const auth = useService(AuthStore);
  const ready = useSignal(auth.ready);
  const loggedIn = useSignal(auth.loggedIn);
  const permissions = useSignal(auth.permissions);
  return { auth, ready, loggedIn, permissions };
}

/**
 * Account pages need a signed-in user; others go to sign in with a `returnUrl`. This is a convenience only: the backend
 * enforces access on every request. Renders nothing until the first session lookup has finished.
 */
export function RequireAuth({ loginPath = '/account/login', children }: { loginPath?: string; children?: ReactNode }) {
  const { ready, loggedIn } = useAuthReady();
  const location = useLocation();
  if (!ready) return null;
  if (!loggedIn) return <Navigate to={`${loginPath}?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children ?? <Outlet />}</>;
}

/** Sign in and register pages are for signed-out visitors only. */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { ready, loggedIn } = useAuthReady();
  if (!ready) return null;
  if (loggedIn) return <Navigate to="/account" replace />;
  return <>{children ?? <Outlet />}</>;
}

/** Requires a permission such as `product:write` (used by the admin app). */
export function RequirePermission({ permission, loginPath = '/account/login', children }: { permission: string; loginPath?: string; children?: ReactNode }) {
  const { ready, permissions } = useAuthReady();
  if (!ready) return null;
  if (!permissions.includes(permission)) return <Navigate to={loginPath} replace />;
  return <>{children ?? <Outlet />}</>;
}
