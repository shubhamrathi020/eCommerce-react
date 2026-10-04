import { useState } from 'react';
import { ApiException, type Serviceability } from '@ecom/contracts';
import { useDate, useResource, useService } from '@shop/core';
import { CatalogApi, SellerPublicApi } from '@shop/data-access';
import { Button, FormField, Rating, inputClass } from '@shop/ui';

/** Who sells this product, how shoppers rate that seller, and the seller's own returns and shipping policy. Hidden for the store's own products. */
export function SellerCard({ sellerId }: { sellerId?: string }) {
  const api = useService(SellerPublicApi);
  const date = useDate();
  const seller = useResource(() => api.profile(sellerId!), [api, sellerId], !!sellerId);
  const s = seller.value;
  if (!sellerId || !s) return null;
  return (
    <section aria-label="Seller" className="rounded-lg border border-border p-3 text-sm">
      <h2 className="mb-1 font-semibold">Sold by {s.displayName}</h2>
      {s.rating.count > 0 ? (
        <p className="flex items-center gap-2">
          <Rating value={s.rating.average} count={s.rating.count} size={16} /> <span className="text-text-muted">seller rating from {s.rating.count} reviews</span>
        </p>
      ) : (
        <p className="text-text-muted">New seller: no reviews yet.</p>
      )}
      <p className="mt-1 text-text-muted">On the marketplace since {date(s.since, 'MMM y')}</p>
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline font-medium">Returns: </dt>
          <dd className="inline text-text-muted">{s.policies.returns}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Shipping: </dt>
          <dd className="inline text-text-muted">{s.policies.shipping}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Pin-code delivery estimate. */
export function DeliveryCheck() {
  const api = useService(CatalogApi);
  const date = useDate();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Serviceability | null>(null);

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    api.serviceability(pin.trim()).subscribe({
      next: (r) => {
        setBusy(false);
        setResult(r);
      },
      error: (err: unknown) => {
        setBusy(false);
        setError(err instanceof ApiException ? err.message : 'Could not check delivery. Please try again.');
      },
    });
  };

  return (
    <div>
      <form className="flex items-end gap-2" onSubmit={check} noValidate>
        <div className="flex-1">
          <FormField label="Delivery pin code" error={error}>
            {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="e.g. 560001" name="pin" value={pin} onChange={(e) => setPin(e.target.value)} />}
          </FormField>
        </div>
        <Button variant="secondary" type="submit" loading={busy}>
          Check
        </Button>
      </form>
      {result && (
        <p className="mt-2 text-sm" role="status">
          {result.serviceable ? (
            <>
              <span className="font-medium text-success">Delivery by {date(result.estimatedDate, 'EEE, d MMM')}</span>
              <span className="text-text-muted">
                {' '}
                ({result.estimatedDays} days){result.codAvailable ? ', cash on delivery available' : ''}
              </span>
            </>
          ) : (
            <span className="font-medium text-danger">Sorry, we do not deliver to {result.pincode} yet.</span>
          )}
        </p>
      )}
    </div>
  );
}
