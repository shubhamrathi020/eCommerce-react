import type { AppConfig } from '@ecom/contracts';
import { APP_CONFIG, type EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { provideDataAccess, resolveBackend } from '@shop/data-access';
import { provideCartFacade } from '@shop/state';

/**
 * Which backend the seller portal talks to (VITE_BACKEND): mock (default), nest, go, node or dotnet. Only sign-in is served by a real API;
 * the marketplace screens use mock data because the marketplace has no backend yet.
 */
const { real, url: backendUrl } = resolveBackend(import.meta.env.VITE_BACKEND as string | undefined);

export const APP_CONFIG_VALUES: AppConfig = {
  useMocks: true,
  realAuth: real,
  realCatalog: false,
  realCommerce: false,
  mockLatencyMs: 200,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? backendUrl,
  siteName: 'Seller Centre',
  siteUrl: typeof location === 'undefined' ? 'http://localhost:5175' : location.origin,
  storefrontUrl: (import.meta.env.VITE_STOREFRONT_URL as string | undefined) ?? 'http://localhost:5173',
  features: {},
};

export function sellerProviders(config: AppConfig = APP_CONFIG_VALUES): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: APP_CONFIG, useValue: config },
    provideDataAccess({ useMocks: config.useMocks, realAuth: config.realAuth, realCatalog: config.realCatalog, realCommerce: config.realCommerce }),
    provideCartFacade(),
  ]);
}
