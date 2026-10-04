import type { AppConfig } from '@ecom/contracts';
import { APP_CONFIG, type EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { provideAdminDataAccess, provideDataAccess } from '@shop/data-access';
import { provideCartFacade } from '@shop/state';

/**
 * Which backend the admin console talks to, chosen when the dev server or build starts (VITE_BACKEND): mock (default), nest
 * (NestJS API on 3333) or go (Go API on 3334). Staff sign-in, product management and order management run against the real
 * API; the other admin screens keep using mock data until their backends exist.
 */
const backend = (import.meta.env.VITE_BACKEND as string | undefined) ?? 'mock';
const real = backend === 'nest' || backend === 'go';

export const APP_CONFIG_VALUES: AppConfig = {
  useMocks: true,
  realAuth: real,
  realCatalog: real,
  realCommerce: real,
  mockLatencyMs: 200,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? (backend === 'go' ? 'http://localhost:3334' : 'http://localhost:3333'),
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
