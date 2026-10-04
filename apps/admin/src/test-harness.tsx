import { act, cleanup, render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { InjectorProvider, MemoryStorage, STORAGE, createInjector } from '@shop/core';
import { DEMO_ACCOUNTS } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { settle as settleDom } from '@shop/ui/testing';
import { adminProviders } from './config';
import { routes } from './routes';

export const admin = DEMO_ACCOUNTS[1];
export const customer = DEMO_ACCOUNTS[0];

const config = { useMocks: true, realAuth: false, realCatalog: false, realCommerce: false, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'Shop Admin', siteUrl: 'http://x', storefrontUrl: 'http://shop.test', features: {} };

/** Mounts the admin app on the mock backend, optionally signed in, with its own storage so tests cannot leak into each other. */
export async function setup(signIn: 'admin' | 'customer' | 'none' = 'admin', url = '/') {
  cleanup();
  localStorage.clear();
  const injector = createInjector([adminProviders(config), { provide: STORAGE, useValue: new MemoryStorage() }]);
  const auth = injector.get(AuthStore);
  await auth.init();
  if (signIn === 'admin') await auth.login(admin.email, admin.password);
  if (signIn === 'customer') await auth.login(customer.email, customer.password);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const view = render(
    <InjectorProvider injector={injector}>
      <RouterProvider router={router} />
    </InjectorProvider>,
  );
  const root = () => view.container;
  const settle = (rounds?: number) => settleDom(root, rounds);
  /** Navigates the way a link click would, then waits for the page to stop changing. */
  const go = async (to: string, rounds = 15) => {
    await act(async () => {
      await router.navigate(to);
    });
    await settle(rounds);
  };
  await settle();
  return { root, router, injector, auth, settle, go, url: () => router.state.location.pathname + router.state.location.search };
}
