import { Outlet, NavLink, useNavigate } from 'react-router';
import { useService, useSignal } from '@shop/core';
import { AuthStore } from '@shop/state';
import { Button, ThemeToggle, ToastContainer, cx } from '@shop/ui';

interface NavItem {
  label: string;
  link: string;
  permission: string;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', link: '/', permission: 'order:read:any', exact: true },
  { label: 'Products', link: '/products', permission: 'product:read' },
  { label: 'Orders', link: '/orders', permission: 'order:read:any' },
  { label: 'Inventory', link: '/inventory', permission: 'inventory:write' },
  { label: 'Returns', link: '/returns', permission: 'return:manage' },
  { label: 'Support', link: '/support', permission: 'support:manage' },
  { label: 'Promotions', link: '/promotions', permission: 'promotion:manage' },
  { label: 'Recommendations', link: '/recommendations', permission: 'recommendation:manage' },
  { label: 'Analytics', link: '/analytics', permission: 'analytics:read' },
  { label: 'Marketplace', link: '/marketplace', permission: 'seller:manage' },
  { label: 'Content', link: '/content', permission: 'content:write' },
  { label: 'Notifications', link: '/notifications', permission: 'notification:manage' },
  { label: 'Reviews', link: '/reviews', permission: 'review:moderate' },
  { label: 'Coupons', link: '/coupons', permission: 'coupon:write' },
  { label: 'Users', link: '/users', permission: 'user:read' },
  { label: 'Audit log', link: '/audit', permission: 'user:read' },
  { label: 'Settings', link: '/settings', permission: 'user:read' },
];

/** Back-office frame: sidebar limited to what the user's permissions allow, plus the signed-in user. */
export function AdminShell() {
  const auth = useService(AuthStore);
  const navigate = useNavigate();
  const user = useSignal(auth.user);
  const permissions = useSignal(auth.permissions);
  const items = NAV.filter((n) => permissions.includes(n.permission));

  return (
    <>
      <a href="#admin-main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:start-2 focus:top-2">
        Skip to main content
      </a>
      <div className="flex min-h-screen flex-col md:flex-row">
        <nav aria-label="Admin" className="border-b border-border bg-surface-alt p-3 md:w-56 md:shrink-0 md:border-b-0 md:border-e md:p-4">
          <p className="mb-2 text-lg font-bold text-primary md:mb-4">Shop Admin</p>
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {items.map((item) => (
              <li key={item.link}>
                <NavLink to={item.link} end={!!item.exact} className={({ isActive }) => cx('flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-border', isActive && 'bg-primary text-primary-contrast')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-end gap-3 border-b border-border px-4 py-2 text-sm">
            <span className="text-text-muted">
              {user?.name} ({user?.roles?.join(', ')})
            </span>
            <ThemeToggle />
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={async () => {
                await auth.logout();
                navigate('/login');
              }}
            >
              Sign out
            </Button>
          </header>
          <main id="admin-main" tabIndex={-1} className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <ToastContainer />
    </>
  );
}
