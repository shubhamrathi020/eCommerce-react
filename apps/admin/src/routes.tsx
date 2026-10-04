import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireAuth, RequirePermission } from '@shop/state';
import { Spinner } from '@shop/ui';
import { AdminShell } from './layouts/AdminShell';
import { ContentLayout, InventoryLayout, MarketplaceLayout, NotificationsLayout, PromotionsLayout, ReturnsLayout } from './layouts/SectionLayout';

/** Every screen is lazy-loaded to keep the initial bundle small. `pick` selects a named export of the module. */
function page(load: () => Promise<Record<string, unknown>>, pick = 'default'): React.ReactElement {
  const Page = lazy(async () => ({ default: (await load())[pick] as ComponentType }));
  return (
    <Suspense fallback={<Spinner />}>
      <Page />
    </Suspense>
  );
}

/**
 * A group of routes that needs one permission. Guards are a browser-side convenience; the API enforces the same permissions on
 * every call, exactly as the real backend must.
 */
const needs = (permission: string, children: RouteObject[]): RouteObject => ({ element: <RequirePermission permission={permission} loginPath="/login" />, children });

const to = (path: string): RouteObject => ({ index: true, element: <Navigate to={path} replace /> });

const children: RouteObject[] = [
  { index: true, element: page(() => import('./dashboard/DashboardPage')) },
  needs('product:read', [
    { path: 'products', element: page(() => import('./products/ProductsPage')) },
    { path: 'products/:id', element: page(() => import('./products/ProductFormPage')) },
  ]),
  needs('product:write', [{ path: 'products/new', element: page(() => import('./products/ProductFormPage')) }]),
  { path: 'orders', element: page(() => import('./orders/OrdersPage')) },
  { path: 'orders/:id', element: page(() => import('./orders/OrderDetailPage')) },
  needs('content:write', [
    {
      path: 'content',
      element: <ContentLayout />,
      children: [
        to('banners'),
        { path: 'banners', element: page(() => import('./content/BannersAndSections'), 'BannersPage') },
        { path: 'sections', element: page(() => import('./content/BannersAndSections'), 'SectionsPage') },
        { path: 'pages', element: page(() => import('./content/PagesLinksRedirects'), 'PagesPage') },
        { path: 'links', element: page(() => import('./content/PagesLinksRedirects'), 'LinksPage') },
        { path: 'redirects', element: page(() => import('./content/PagesLinksRedirects'), 'RedirectsPage') },
      ],
    },
  ]),
  needs('inventory:write', [
    {
      path: 'inventory',
      element: <InventoryLayout />,
      children: [
        to('stock'),
        { path: 'stock', element: page(() => import('./inventory/StockPage')) },
        { path: 'ledger', element: page(() => import('./inventory/LedgerImportSettings'), 'LedgerPage') },
        { path: 'import', element: page(() => import('./inventory/LedgerImportSettings'), 'ImportPage') },
        { path: 'settings', element: page(() => import('./inventory/LedgerImportSettings'), 'InventorySettingsPage') },
      ],
    },
  ]),
  needs('return:manage', [
    {
      path: 'returns',
      element: <ReturnsLayout />,
      children: [
        to('queue'),
        { path: 'queue', element: page(() => import('./returns/ReturnsQueueAndDetail'), 'ReturnsQueuePage') },
        { path: 'queue/:id', element: page(() => import('./returns/ReturnsQueueAndDetail'), 'ReturnDetailPage') },
        needs('order:refund', [{ path: 'refunds', element: page(() => import('./returns/RefundsAndPolicy'), 'RefundsPage') }]),
        { path: 'policy', element: page(() => import('./returns/RefundsAndPolicy'), 'PolicyPage') },
      ],
    },
  ]),
  needs('promotion:manage', [
    {
      path: 'promotions',
      element: <PromotionsLayout />,
      children: [
        to('list'),
        { path: 'list', element: page(() => import('./promotions/PromotionsPages'), 'PromotionsPage') },
        { path: 'list/new', element: page(() => import('./promotions/PromotionsPages'), 'PromotionFormPage') },
        { path: 'list/:id', element: page(() => import('./promotions/PromotionsPages'), 'PromotionFormPage') },
        { path: 'simulator', element: page(() => import('./promotions/SimulatorGiftCardsHealth'), 'SimulatorPage') },
        { path: 'gift-cards', element: page(() => import('./promotions/SimulatorGiftCardsHealth'), 'GiftCardsPage') },
        { path: 'price-health', element: page(() => import('./promotions/SimulatorGiftCardsHealth'), 'PriceHealthPage') },
      ],
    },
  ]),
  needs('review:moderate', [{ path: 'reviews', element: page(() => import('./pages/ReviewsAndUsers'), 'ReviewsPage') }]),
  needs('coupon:write', [{ path: 'coupons', element: page(() => import('./pages/CouponsPage')) }]),
  needs('user:read', [
    { path: 'users', element: page(() => import('./pages/ReviewsAndUsers'), 'UsersPage') },
    { path: 'audit', element: page(() => import('./pages/ReviewsAndUsers'), 'AuditPage') },
    { path: 'settings', element: page(() => import('./pages/ReviewsAndUsers'), 'SettingsPage') },
  ]),
];

export const routes: RouteObject[] = [
  { path: '/login', element: page(() => import('./layouts/LoginPage')) },
  {
    path: '/',
    element: <RequireAuth loginPath="/login" />,
    children: [
      {
        element: <RequirePermission permission="order:read:any" loginPath="/login" />,
        children: [{ element: <AdminShell />, children: [...children, { path: '*', element: <Navigate to="/" replace /> }] }],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);

// Section layouts are used by the grouped routes added below as those screens are ported.
export { ContentLayout, InventoryLayout, MarketplaceLayout, NotificationsLayout, PromotionsLayout, ReturnsLayout, needs, page, to };
