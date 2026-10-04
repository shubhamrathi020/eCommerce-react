import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { Spinner } from '@shop/ui';
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
      { path: 'pages/:slug', element: <StaticPage /> },
      { path: '*', element: <RedirectOrNotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
