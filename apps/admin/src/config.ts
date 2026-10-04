import type { AppConfig } from '@ecom/contracts';
import { APP_CONFIG, type EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { provideAdminDataAccess, provideDataAccess, resolveBackend } from '@shop/data-access';
import { provideCartFacade } from '@shop/state';

/**
 * Which backend the admin console talks to, chosen when the dev server or build starts (VITE_BACKEND): mock (default), nest
 * (NestJS API on 3333), go (Go API on 3334), node (Node API on 3335) or dotnet (.NET API on 3336). Staff sign-in, product management and order management run against the real
 * API; the other admin screens keep using mock data until their backends exist.
 */
const { real, url: backendUrl } = resolveBackend(import.meta.env.VITE_BACKEND as string | undefined);

export const APP_CONFIG_VALUES: AppConfig = {
  useMocks: true,
  realAuth: real,
  realCatalog: real,
  realCommerce: real,
  mockLatencyMs: 200,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? backendUrl,
  siteName: 'Shop Admin',
  siteUrl: typeof location === 'undefined' ? 'http://localhost:5174' : location.origin,
  storefrontUrl: (import.meta.env.VITE_STOREFRONT_URL as string | undefined) ?? 'http://localhost:5173',
  features: {},
};

export function adminProviders(config: AppConfig = APP_CONFIG_VALUES): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: APP_CONFIG, useValue: config },
    provideDataAccess({ useMocks: config.useMocks, realAuth: config.realAuth, realCatalog: config.realCatalog, realCommerce: config.realCommerce }),
    provideAdminDataAccess({ useMocks: config.useMocks, realCatalog: config.realCatalog, realCommerce: config.realCommerce }),
    provideCartFacade(),
  ]);
}
