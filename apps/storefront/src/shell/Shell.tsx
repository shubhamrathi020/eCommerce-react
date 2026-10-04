import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { AttributionService, ConsentService, NetworkStatusService, useService, useSignal, useT } from '@shop/core';
import { CartStore } from '@shop/state';
import { ButtonLink, CartLine, Drawer, OrderSummary, ToastContainer, Button } from '@shop/ui';
import { Footer } from './Footer';
import { Header } from './Header';

/** Slide-in cart shown after "Add to cart". */
export function MiniCart() {
  const t = useT();
  const store = useService(CartStore);
  const open = useSignal(store.miniCartOpen);
  const cart = useSignal(store.cart);
  return (
    <Drawer open={open} onOpenChange={(v) => store.miniCartOpen.set(v)} label={t('miniCart.title')} side="right">
      {cart &&
        (cart.lines.length === 0 ? (
          <p className="text-text-muted">{t('miniCart.empty')}</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {cart.lines.map((line) => (
                <li key={line.variantId} className="py-3">
                  <CartLine line={line} compact onQuantityChange={(q) => void store.setQuantity(line.variantId, q)} onRemove={() => void store.remove(line.variantId, line.title)} />
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <OrderSummary totals={cart.totals} coupon={cart.coupon} promotions={cart.promotions} />
            </div>
            <div className="mt-4 grid gap-2">
              <ButtonLink to="/checkout" onClick={() => store.miniCartOpen.set(false)}>
                {t('miniCart.checkout')}
              </ButtonLink>
              <ButtonLink to="/cart" variant="secondary" onClick={() => store.miniCartOpen.set(false)}>
                {t('miniCart.view')}
              </ButtonLink>
            </div>
          </>
        ))}
    </Drawer>
  );
}

export function CookieBanner() {
  const t = useT();
  const consent = useService(ConsentService);
  const needsDecision = useSignal(consent.needsDecision);
  if (!needsDecision) return null;
  return (
    <section aria-label={t('cookie.label')} className="print:hidden fixed inset-x-0 bottom-0 z-[15] border-t border-border bg-surface p-4 shadow-modal">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-text">
          {t('cookie.text')}{' '}
          <Link to="/pages/privacy" className="text-primary underline">
            {t('cookie.privacy')}
          </Link>
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => consent.set('essential')}>
            {t('cookie.essential')}
          </Button>
          <Button onClick={() => consent.set('all')}>{t('cookie.all')}</Button>
        </div>
      </div>
    </section>
  );
}

/** A persistent notice while the browser has no network connection; some actions may not work until it returns. */
export function OfflineBanner() {
  const t = useT();
  const network = useService(NetworkStatusService);
  const online = useSignal(network.online);
  const savedCopy = useSignal(network.savedCopy);
  return (
    <>
      {!online && (
        <div className="print:hidden bg-warning px-4 py-2 text-center text-sm font-medium text-on-status" role="status">
          {t('offline.banner')}
        </div>
      )}
      {savedCopy && (
        <div className="print:hidden bg-warning px-4 py-2 text-center text-sm font-medium text-on-status" role="status">
          {t('offline.savedCopy')}
        </div>
      )}
    </>
  );
}

export function ShellLayout() {
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const [params] = useSearchParams();
  const attribution = useService(AttributionService);
  const consent = useService(ConsentService);
  const analyticsAllowed = useSignal(consent.analyticsAllowed);

  // Screen-reader and keyboard users land on the new page's heading after every route change, the same way a full page load
  // would put focus at the top.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    queueMicrotask(() => {
      const root = main.current;
      if (!root) return;
      const target = root.querySelector<HTMLElement>('h1') ?? root;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  }, [location.pathname]);

  // Campaign tags from the landing URL (utm_*) are remembered once the shopper has accepted analytics, including when they
  // accept on the landing page itself.
  useEffect(() => {
    if (analyticsAllowed) attribution.capture(Object.fromEntries(params.entries()));
  }, [analyticsAllowed, params, attribution, location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only print:hidden z-50 rounded-md bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:start-2 focus:top-2">
        Skip to main content
      </a>
      <OfflineBanner />
      <Header />
      <main ref={main} id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        <Outlet />
      </main>
      <Footer />
      <MiniCart />
      <CookieBanner />
      <ToastContainer />
    </div>
  );
}
