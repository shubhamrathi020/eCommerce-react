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
      { path: 'pages/:slug', element: <StaticPage /> },
      { path: '*', element: <RedirectOrNotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
