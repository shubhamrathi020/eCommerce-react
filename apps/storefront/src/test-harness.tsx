import { act, cleanup, render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { InjectorProvider, MemoryStorage, STORAGE, createInjector, type Injector } from '@shop/core';
import { DEMO_ACCOUNTS, provideAdminDataAccess } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { settle as settleDom } from '@shop/ui/testing';
import { storefrontProviders } from './config';
import { routes } from './routes';

export const demo = DEMO_ACCOUNTS[0];

export const config = { useMocks: true, realAuth: false, realCatalog: false, realCommerce: false, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'Shop', siteUrl: 'http://x', features: {} };

/**
 * Mounts the whole storefront (shell included) on the mock backend, with its own storage so tests cannot leak into each other.
 * `prepare` runs before anything is drawn, to seed data or sign in.
 */
export async function open(url: string, prepare?: (injector: Injector) => Promise<void>) {
  cleanup();
  localStorage.clear();
  document.getElementById('seo-jsonld')?.remove();
  // The admin adapters are provided too so tests can play staff (refund an order, approve a seller) against the same mock data.
  const injector = createInjector([storefrontProviders(config), provideAdminDataAccess({ useMocks: true }), { provide: STORAGE, useValue: new MemoryStorage() }]);
  await prepare?.(injector);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const view = render(
    <InjectorProvider injector={injector}>
      <RouterProvider router={router} />
    </InjectorProvider>,
  );
  const root = () => view.container;
  /** The page itself, without the shell around it. */
  const main = () => view.container.querySelector('main') as HTMLElement;
  const settle = (rounds?: number) => settleDom(root, rounds);
  const go = async (to: string, rounds = 15) => {
    await act(async () => {
      await router.navigate(to);
    });
    await settle(rounds);
  };
  await settle(20);
  return { root, main, router, injector, settle, go, url: () => router.state.location.pathname + router.state.location.search };
}

/** Opens a page signed in as the demo customer. */
export const openSignedIn = (url: string, prepare?: (injector: Injector) => Promise<void>) =>
  open(url, async (injector) => {
    const auth = injector.get(AuthStore);
    await auth.init();
    await auth.login(demo.email, demo.password);
    await prepare?.(injector);
  });
