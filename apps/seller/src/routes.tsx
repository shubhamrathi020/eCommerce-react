import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireAuth, RequirePermission } from '@shop/state';
import { Spinner } from '@shop/ui';
import { ApplyPage, SellerDashboard, SellerLogin, SellerRegister, SellerShell } from './SellerPages';

/** The working pages are lazy-loaded; the sign-in, apply and overview pages every account can reach are small and load up front. */
function work(pick: string): React.ReactElement {
  const Page = lazy(async () => ({ default: ((await import('./WorkPages')) as unknown as Record<string, ComponentType>)[pick] }));
  return (
    <Suspense fallback={<Spinner />}>
      <Page />
    </Suspense>
  );
}

/**
 * Seller portal routes. Guards are a browser-side convenience; the API works out which seller is calling from the signed-in
 * user on every request and never trusts an id from the browser, exactly as the real backend must. Anyone with an account can
 * apply; the portal's working pages need the `seller:portal` permission, which approval grants.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <SellerLogin /> },
  { path: '/register', element: <SellerRegister /> },
  {
    path: '/',
    element: <RequireAuth loginPath="/login" />,
    children: [
      {
        element: <SellerShell />,
        children: [
          { index: true, element: <SellerDashboard /> },
          { path: 'apply', element: <ApplyPage /> },
          {
            element: <RequirePermission permission="seller:portal" loginPath="/" />,
            children: [
              { path: 'products', element: work('ProductsPage') },
              { path: 'products/new', element: work('ProductFormPage') },
              { path: 'products/:id', element: work('ProductFormPage') },
              { path: 'orders', element: work('OrdersPage') },
              { path: 'payouts', element: work('PayoutsPage') },
            ],
          },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
