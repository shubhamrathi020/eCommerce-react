import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException } from '@ecom/contracts';
import { I18nService, SeoService, useMoney, useResource, useService, useSignal, useT } from '@shop/core';
import { WalletApi } from '@shop/data-access';
import { AuthStore, CartStore } from '@shop/state';
import { Button, ButtonLink, CartLine, EmptyState, FormField, OrderSummary, Skeleton, inputClass } from '@shop/ui';

/** Gift card and store credit on the cart. The cart prices them; this only asks and refreshes. */
function WalletPanel() {
  const t = useT();
  const money = useMoney();
  const store = useService(CartStore);
  const auth = useService(AuthStore);
  const api = useService(WalletApi);
  const cart = useSignal(store.cart);
  const loggedIn = useSignal(auth.loggedIn);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const summary = useResource(() => api.summary(), [api, loggedIn], loggedIn);
  const credit = loggedIn ? (summary.value?.credit.amount ?? 0) : 0;

  const change = async (input: Parameters<WalletApi['apply']>[0]): Promise<boolean> => {
    setError('');
    setBusy(true);
    try {
      await firstValueFrom(api.apply(input));
      await store.refresh();
      return true;
    } catch (e) {
      setError(e instanceof ApiException ? (e.fields?.['code'] ?? e.message) : t('wallet.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!cart) return null;
  return (
    <section className="mb-3 border-b border-border pb-3" aria-label={t('wallet.label')}>
      {cart.giftCardCode ? (
        <p className="mb-2 flex items-center justify-between text-sm">
          <span>{t('wallet.applied', { code: cart.giftCardCode })}</span>
          <button type="button" className="min-h-11 font-medium text-danger hover:underline" onClick={() => void change({ giftCardCode: null })}>
            {t('common.remove')}
          </button>
        </p>
      ) : (
        <form
          className="flex items-end gap-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) {
              setError(t('wallet.codeEnter'));
              return;
            }
            if (await change({ giftCardCode: code })) setCode('');
          }}
        >
          <div className="flex-1">
            <FormField label={t('wallet.codeLabel')} error={error} hint={t('wallet.codeHint')}>
              {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} autoComplete="off" name="giftcard" value={code} onChange={(e) => setCode(e.target.value)} />}
            </FormField>
          </div>
          <Button variant="secondary" type="submit" loading={busy}>
            {t('cart.apply')}
          </Button>
        </form>
      )}
      {loggedIn && credit > 0 && (
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={!!cart.useCredit} onChange={(e) => void change({ useCredit: e.target.checked })} />
          {t('wallet.useCredit', { amount: money({ amount: credit, currency: 'INR' }) })}
        </label>
      )}
    </section>
  );
}

export default function CartPage() {
  const t = useT();
  const money = useMoney();
  const i18n = useService(I18nService);
  const seo = useService(SeoService);
  const store = useService(CartStore);
  const loaded = useSignal(store.loaded);
  const cart = useSignal(store.cart);
  const busy = useSignal(store.busy);
  const [code, setCode] = useState('');
  const [couponError, setCouponError] = useState('');

  useEffect(() => {
    seo.set({ title: 'Your cart', noindex: true, path: '/cart' });
    void store.refresh();
  }, [seo, store]);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError('');
    if (!code.trim()) {
      setCouponError(i18n.t('cart.couponEnter'));
      return;
    }
    const result = await store.applyCoupon(code);
    if (result.ok) setCode('');
    else setCouponError(result.message ?? i18n.t('cart.couponFailed'));
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">{t('cart.title')}</h1>
      {!loaded || !cart ? (
        <Skeleton className="h-40" />
      ) : cart.lines.length === 0 ? (
        <EmptyState title={t('cart.emptyTitle')} description={t('cart.emptyText')}>
          <ButtonLink to="/">{t('cart.continue')}</ButtonLink>
        </EmptyState>
      ) : (
        <>
          {cart.notices.length > 0 && (
            <div className="mb-4 rounded-md border border-warning p-3 text-sm" role="status">
              <ul className="list-disc space-y-1 ps-5">
                {cart.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <section aria-label={t('cart.items')}>
              <ul className="divide-y divide-border rounded-lg border border-border px-4">
                {cart.lines.map((line) => (
                  <li key={line.variantId} className="py-4">
                    <CartLine line={line} onQuantityChange={(q) => void store.setQuantity(line.variantId, q)} onRemove={() => void store.remove(line.variantId, line.title)} />
                  </li>
                ))}
              </ul>
              <Link to="/" className="mt-4 inline-flex min-h-11 items-center font-medium text-primary hover:underline">
                {t('cart.continue')}
              </Link>
            </section>

            <aside className="space-y-4" aria-label={t('cart.summary')}>
              {cart.totals.amountToFreeShipping ? (
                <p className="rounded-md bg-surface-alt p-3 text-sm" role="status">
                  {t('cart.addForFreeShipping', { amount: money(cart.totals.amountToFreeShipping) })}
                </p>
              ) : (
                cart.totals.shipping.amount === 0 &&
                cart.totals.itemCount > 0 && (
                  <p className="rounded-md bg-surface-alt p-3 text-sm text-success" role="status">
                    {t('cart.freeShipping')}
                  </p>
                )
              )}

              <div className="rounded-lg border border-border p-4">
                {cart.coupon ? (
                  <p className="mb-3 flex items-center justify-between text-sm">
                    <span>{t('cart.couponApplied', { code: cart.coupon.code })}</span>
                    <button type="button" className="min-h-11 font-medium text-danger hover:underline" onClick={() => void store.removeCoupon()}>
                      {t('common.remove')}
                    </button>
                  </p>
                ) : (
                  <form className="mb-3 flex items-end gap-2" onSubmit={apply} noValidate>
                    <div className="flex-1">
                      <FormField label={t('cart.couponLabel')} error={couponError} hint={t('cart.couponHint')}>
                        {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={couponError ? 'true' : undefined} autoComplete="off" name="code" value={code} onChange={(e) => setCode(e.target.value)} />}
                      </FormField>
                    </div>
                    <Button variant="secondary" type="submit" loading={busy}>
                      {t('cart.apply')}
                    </Button>
                  </form>
                )}
                <WalletPanel />
                <OrderSummary totals={cart.totals} coupon={cart.coupon} promotions={cart.promotions} />
                <ButtonLink to="/checkout" className="mt-4 w-full" aria-disabled={cart.blocked ? 'true' : undefined} onClick={(e) => cart.blocked && e.preventDefault()}>
                  {t('cart.checkout')}
                </ButtonLink>
                {cart.blocked && (
                  <p className="mt-2 text-sm text-danger" role="alert">
                    {t('cart.blocked')}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
