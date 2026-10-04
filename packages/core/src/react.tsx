import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { type Injector, type Signal, type Token, rootInjector, subscribeTo } from './runtime';
import { I18nService } from './lib/i18n/i18n.service';
import type { MessageParams } from './lib/i18n/message-format';
import { type Money, formatMoney } from '@ecom/contracts';

const InjectorContext = createContext<Injector | null>(null);

/** Makes an injector the one components resolve services from (the app root, or a test). */
export function InjectorProvider({ injector, children }: { injector: Injector; children: ReactNode }) {
  return <InjectorContext.Provider value={injector}>{children}</InjectorContext.Provider>;
}

export function useInjector(): Injector {
  return useContext(InjectorContext) ?? rootInjector();
}

/** The service registered for a token. */
export function useService<T>(token: Token<T>): T {
  const injector = useInjector();
  return useMemo(() => injector.get(token), [injector, token]);
}

/** Re-renders the component whenever the signal changes, and returns its current value. */
export function useSignal<T>(s: Signal<T>): T {
  return useSyncExternalStore(
    (listener) => subscribeTo(s, listener),
    () => s(),
    () => s(),
  );
}

/** A translate function that re-renders when the language changes. */
export function useT(): (key: string, params?: MessageParams) => string {
  const i18n = useService(I18nService);
  const locale = useSignal(i18n.locale);
  return useMemo(() => (key: string, params?: MessageParams) => i18n.t(key, params), [i18n, locale]);
}

/** A date formatter that follows the shop's language. */
export function useDate(): (value: Date | string | number | null | undefined, pattern?: string) => string {
  const i18n = useService(I18nService);
  const locale = useSignal(i18n.locale);
  return useMemo(() => (value, pattern) => i18n.date(value, pattern), [i18n, locale]);
}

/** A money formatter that follows the shop's language (grouping, digits and symbol placement); the stored amount never changes. */
export function useMoney(): (value: Money | null | undefined) => string {
  const i18n = useService(I18nService);
  const locale = useSignal(i18n.locale);
  return useMemo(() => (value) => (value ? formatMoney(value, i18n.info().intl) : ''), [i18n, locale]);
}
