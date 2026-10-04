import type { AppConfig } from '@ecom/contracts';
import { APP_CONFIG, type EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { provideDataAccess, resolveBackend } from '@shop/data-access';
import { provideCartFacade } from '@shop/state';

/**
 * Which backend the storefront talks to, chosen when the dev server or build starts (VITE_BACKEND):
 *   mock  everything runs on built-in mock data in the browser (the default)
 *   nest    the NestJS API (eCommerce-api, port 3333)
 *   go      the Go API (eCommerce-go, port 3334)
 *   node    the Node API (eCommerce-node, port 3335)
 *   dotnet  the .NET API (eCommerce-dotnet, port 3336)
 * All real backends serve the same API, so nothing else changes. VITE_API_BASE_URL overrides the address.
 */
const { real, url: backendUrl } = resolveBackend(import.meta.env.VITE_BACKEND as string | undefined);

export const APP_CONFIG_VALUES: AppConfig = {
  useMocks: true,
  realAuth: real,
  realCatalog: real,
  realCommerce: real,
  mockLatencyMs: 250,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? backendUrl,
  siteName: 'Shop',
  siteUrl: typeof location === 'undefined' ? 'http://localhost:5173' : location.origin,
  features: {},
};

/** Everything the storefront's services are built from. */
export function storefrontProviders(config: AppConfig = APP_CONFIG_VALUES): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: APP_CONFIG, useValue: config },
    provideDataAccess({ useMocks: config.useMocks, realAuth: config.realAuth, realCatalog: config.realCatalog, realCommerce: config.realCommerce }),
    provideCartFacade(),
  ]);
}
