import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminReturnApi, CategoryApi } from '@shop/data-access';
import { Button, EmptyState, ErrorState, FormField, Skeleton, inputClass } from '@shop/ui';
import { paiseToRupees, rupeesToPaise } from '../lib/list-params';

/** Prepaid orders that were cancelled and are waiting for their money to go back. Needs `order:refund`. */
export function RefundsPage() {
  const api = useService(AdminReturnApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.pendingOrderRefunds(), [api]);
  const [busyId, setBusyId] = useState('');
  useEffect(() => {
    seo.set({ title: 'Order refunds', noindex: true });
  }, [seo]);

  const refund = async (orderId: string) => {
    setBusyId(orderId);
    try {
      await firstValueFrom(api.refundOrder(orderId));
      toast.success(`Refund for ${orderId} marked as paid.`);
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not record the refund.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <>
      <p className="mb-4 text-sm text-text-muted">When a customer cancels an order they already paid for, the order shows “refund in progress” until you send the money back and mark it here. No real payment is made in this demo.</p>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Cancelled prepaid orders that need a refund appear here." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-start text-sm">
              <caption className="sr-only">Cancelled orders waiting for a refund</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Order</th>
                  <th scope="col" className="p-2 text-start">Customer</th>
                  <th scope="col" className="p-2 text-start">Cancelled</th>
                  <th scope="col" className="p-2 text-end">Amount</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((p) => (
                  <tr key={p.orderId}>
                    <td className="p-2">
                      <Link to={`/orders/${p.orderId}`} className="text-primary hover:underline">
                        {p.orderId}
                      </Link>
                    </td>
                    <td className="p-2">{p.customerName}</td>
                    <td className="whitespace-nowrap p-2 text-text-muted">{p.cancelledAt ? date(p.cancelledAt, 'd MMM y, h:mm a') : ''}</td>
                    <td className="p-2 text-end">{money(p.amount)}</td>
                    <td className="p-2 text-end">
                      <Button size="sm" type="button" loading={busyId === p.orderId} onClick={() => void refund(p.orderId)}>
                        Mark refunded
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}

/** Return policy. Each request keeps a copy of the numbers it was made under, so edits only affect new requests. */
export function PolicyPage() {
  const api = useService(AdminReturnApi);
  const categoryApi = useService(CategoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const policy = useResource(() => api.policy(), [api]);
  const categories = useResource(() => categoryApi.tree(), [categoryApi]).value ?? [];

  const [windowDays, setWindowDays] = useState('7');
  const [fee, setFee] = useState('49');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [products, setProducts] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [updated, setUpdated] = useState<{ at: string; by: string } | null>(null);
  useEffect(() => {
    seo.set({ title: 'Return policy', noindex: true });
  }, [seo]);
  useEffect(() => {
    const p = policy.value;
    if (!p) return;
    setWindowDays(String(p.windowDays));
    setFee(paiseToRupees(p.returnFee));
    setExcluded(p.excludedCategoryIds);
    setProducts(p.excludedProductIds.join('\n'));
    setUpdated(p.updatedBy === 'system' ? null : { at: p.updatedAt, by: p.updatedBy });
  }, [policy.value]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const feePaise = rupeesToPaise(fee);
    const days = Number(windowDays);
    const local: Record<string, string> = {};
    if (feePaise === undefined) local['returnFee'] = 'Enter an amount in rupees';
    if (windowDays.trim() === '' || !Number.isInteger(days)) local['windowDays'] = 'Enter a whole number of days';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      const saved = await firstValueFrom(
        api.savePolicy({ windowDays: days, returnFee: feePaise as number, excludedCategoryIds: excluded, excludedProductIds: products.split(/[\s,]+/).filter(Boolean) }),
      );
      setUpdated({ at: saved.updatedAt, by: saved.updatedBy });
      toast.success('Return policy saved. It applies to new requests.');
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        if (!err.fields) setFormError(err.message);
      } else setFormError('Could not save the policy.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">
        Changes apply to return requests made from now on. Requests already open keep the rules they were made under. Defaults: a 7-day window, a ₹49 return shipping fee when the customer changes their mind, free pickup when the problem is ours. Refunds only; exchanges are not supported.
      </p>
      {policy.value ? (
        <form className="max-w-xl space-y-5" onSubmit={save} noValidate>
          <FormField label="Return window (days after delivery)" required error={errors['windowDays'] ?? ''}>
            {(f) => <input id={f.id} className={inputClass} type="number" min={0} max={90} value={windowDays} aria-describedby={f.describedBy} aria-invalid={errors['windowDays'] ? 'true' : undefined} onChange={(e) => setWindowDays(e.target.value)} />}
          </FormField>
          <FormField label="Return shipping fee in ₹ (customer's choice returns)" required error={errors['returnFee'] ?? ''}>
            {(f) => <input id={f.id} className={inputClass} inputMode="decimal" value={fee} aria-describedby={f.describedBy} aria-invalid={errors['returnFee'] ? 'true' : undefined} onChange={(e) => setFee(e.target.value)} />}
          </FormField>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Categories that cannot be returned</legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {categories.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5 accent-primary" checked={excluded.includes(c.id)} onChange={(e) => setExcluded((list) => (e.target.checked ? [...new Set([...list, c.id])] : list.filter((x) => x !== c.id)))} />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <FormField label="Non-returnable product IDs" hint="One per line or comma separated, e.g. p-0005">
            {(f) => <textarea id={f.id} className={inputClass} rows={3} value={products} aria-describedby={f.describedBy} onChange={(e) => setProducts(e.target.value)} />}
          </FormField>

          {formError && (
            <p className="text-sm text-danger" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" loading={saving}>
            Save policy
          </Button>
          {updated && (
            <p className="text-sm text-text-muted">
              Last changed {date(updated.at, 'd MMM y, h:mm a')} by {updated.by}.
            </p>
          )}
        </form>
      ) : (
        <Skeleton className="h-64 max-w-xl" />
      )}
    </>
  );
}
