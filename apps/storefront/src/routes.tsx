import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { CartNotEmpty } from './checkout/guards';
import { Spinner } from '@shop/ui';
import { GuestOnly, RequireAuth } from '@shop/state';
import { RedirectOrNotFound, StaticPage } from './shell/Pages';
import { ShellLayout } from './shell/Shell';

/** Every page is lazy-loaded to keep the initial bundle small. */
function page(load: () => Promise<{ default: ComponentType }>): RouteObject['element'] {
  const Page = lazy(load);
  return (
    <Suspense fallback={<Spinner />}>
      <Page />
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <ShellLayout />,
    children: [
      { index: true, element: page(() => import('./catalog/HomePage')) },
      { path: 'c/:slug', element: page(() => import('./catalog/ListingPage').then((m) => ({ default: m.CategoryListing }))) },
      { path: 'b/:slug', element: page(() => import('./catalog/ListingPage').then((m) => ({ default: m.BrandListing }))) },
      { path: 'collections/:slug', element: page(() => import('./catalog/ListingPage').then((m) => ({ default: m.CollectionListing }))) },
      { path: 'search', element: page(() => import('./catalog/ListingPage').then((m) => ({ default: m.SearchListing }))) },
      { path: 'p/:slug', element: page(() => import('./catalog/ProductPage')) },
      { path: 'compare', element: page(() => import('./catalog/Compare')) },
      { path: 'cart', element: page(() => import('./checkout/CartPage')) },
      { path: 'checkout', element: <CartNotEmpty>{page(() => import('./checkout/CheckoutPage'))}</CartNotEmpty> },
      { path: 'orders', element: page(() => import('./checkout/OrderPages').then((m) => ({ default: m.OrdersListPage }))) },
      { path: 'orders/:id', element: page(() => import('./checkout/OrderPages').then((m) => ({ default: m.OrderPage }))) },
      { path: 'orders/:id/invoice', element: page(() => import('./checkout/OrderPages').then((m) => ({ default: m.InvoicePage }))) },
      {
        element: <RequireAuth />,
        children: [
          { path: 'account', element: page(() => import('./account/AccountPages').then((m) => ({ default: m.AccountHome }))) },
          { path: 'account/profile', element: page(() => import('./account/AccountPages').then((m) => ({ default: m.ProfilePage }))) },
          { path: 'account/addresses', element: page(() => import('./account/SettingsPages').then((m) => ({ default: m.AddressesPage }))) },
          { path: 'account/privacy', element: page(() => import('./account/SettingsPages').then((m) => ({ default: m.PrivacyPage }))) },
          { path: 'account/preferences', element: page(() => import('./account/SettingsPages').then((m) => ({ default: m.PreferencesPage }))) },
          { path: 'account/alerts', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.AlertsPage }))) },
          { path: 'account/returns', element: page(() => import('./account/ReturnsPages').then((m) => ({ default: m.ReturnsListPage }))) },
          { path: 'account/returns/new', element: page(() => import('./account/ReturnsPages').then((m) => ({ default: m.ReturnRequestPage }))) },
          { path: 'account/returns/:id', element: page(() => import('./account/ReturnsPages').then((m) => ({ default: m.ReturnDetailPage }))) },
          { path: 'account/support', element: page(() => import('./account/SupportPages').then((m) => ({ default: m.SupportListPage }))) },
          { path: 'account/support/new', element: page(() => import('./account/SupportPages').then((m) => ({ default: m.SupportNewPage }))) },
          { path: 'account/support/:id', element: page(() => import('./account/SupportPages').then((m) => ({ default: m.SupportDetailPage }))) },
          { path: 'notifications', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.NotificationsPage }))) },
        ],
      },
      {
        element: <GuestOnly />,
        children: [
          { path: 'account/login', element: page(() => import('./account/AuthPages').then((m) => ({ default: m.LoginPage }))) },
          { path: 'account/register', element: page(() => import('./account/AuthPages').then((m) => ({ default: m.RegisterPage }))) },
        ],
      },
      { path: 'account/forgot-password', element: page(() => import('./account/AuthPages').then((m) => ({ default: m.ForgotPasswordPage }))) },
      { path: 'account/reset-password', element: page(() => import('./account/AuthPages').then((m) => ({ default: m.ResetPasswordPage }))) },
      { path: 'account/verify-email', element: page(() => import('./account/AuthPages').then((m) => ({ default: m.VerifyEmailPage }))) },
      { path: 'personalisation', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.PersonalisationPage }))) },
      { path: 'unsubscribe', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.UnsubscribePage }))) },
      { path: 'wishlist', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.WishlistPage }))) },
      ...(import.meta.env.DEV ? [{ path: 'dev/mailbox', element: page(() => import('./account/ShopperPages').then((m) => ({ default: m.MailboxPage }))) }] : []),
      { path: 'pages/:slug', element: <StaticPage /> },
      { path: '*', element: <RedirectOrNotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
