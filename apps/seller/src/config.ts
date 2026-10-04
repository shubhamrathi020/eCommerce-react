import type { AppConfig } from '@ecom/contracts';
import { APP_CONFIG, type EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { provideDataAccess } from '@shop/data-access';
import { provideCartFacade } from '@shop/state';

/**
 * Which backend the seller portal talks to (VITE_BACKEND): mock (default), nest or go. Only sign-in is served by a real API;
 * the marketplace screens use mock data because the marketplace has no backend yet.
 */
const backend = (import.meta.env.VITE_BACKEND as string | undefined) ?? 'mock';
const real = backend === 'nest' || backend === 'go';

export const APP_CONFIG_VALUES: AppConfig = {
  useMocks: true,
  realAuth: real,
  realCatalog: false,
  realCommerce: false,
  mockLatencyMs: 200,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? (backend === 'go' ? 'http://localhost:3334' : 'http://localhost:3333'),
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
