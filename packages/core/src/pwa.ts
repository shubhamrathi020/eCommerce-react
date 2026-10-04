import { type EnvironmentProviders, makeEnvironmentProviders, provideEnvironmentInitializer } from './runtime';

/**
 * Registers the shop's service worker (`/sw.js`) once the page has loaded. Production builds only: in development a service
 * worker would hide edits behind its caches. Safe where service workers do not exist (older browsers, private windows).
 * The worker's own rules decide what may be kept; see apps/storefront/public/sw.js.
 */
export function provideShopServiceWorker(options: { script?: string; enabled?: boolean } = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const enabled = options.enabled ?? !import.meta.env.DEV;
      if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
      const register = () => void navigator.serviceWorker.register(options.script ?? '/sw.js', { scope: '/' }).catch(() => undefined);
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }),
  ]);
}
