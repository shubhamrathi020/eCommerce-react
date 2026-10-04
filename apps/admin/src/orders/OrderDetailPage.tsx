import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiException, type AdminOrderDetail, type OrderStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminOrderApi } from '@shop/data-access';
import { Badge, Button, CartLine, ErrorState, FormField, NotFound, OrderSummary, Skeleton, inputClass } from '@shop/ui';
import { statusTone } from './OrdersPage';

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = { packed: 'Mark as packed', shipped: 'Mark as shipped', delivered: 'Mark as delivered', cancelled: 'Cancel order' };

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const api = useService(AdminOrderApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.get(id), [api, id]);
  const [latest, setLatest] = useState<AdminOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');

  useEffect(() => {
    seo.set({ title: 'Order', noindex: true });
  }, [seo]);

  const o = latest?.id === id ? latest : resource.value;
  const missing = resource.status === 'error' && resource.error instanceof ApiException && resource.error.code === 'not_found';

  const apply = async (request: Observable<AdminOrderDetail>): Promise<boolean> => {
    try {
      setLatest(await firstValueFrom(request));
      return true;
    } catch (e) {
      if (e instanceof ApiException && e.fields?.['text']) setNoteError(e.fields['text']);
      else toast.error(e instanceof ApiException ? e.message : 'The action failed.');
      return false;
    }
  };

  const advance = async (status: OrderStatus) => {
    setBusy(true);
    if (await apply(api.advance(id, status))) toast.success(status === 'cancelled' ? 'Order cancelled' : 'Order updated');
    setConfirmCancel(false);
    setBusy(false);
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setNoteError('');
    if (await apply(api.addNote(id, note))) setNote('');
  };

  if (missing) return <NotFound />;
  if (!o) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-48" />;

  return (
    <>
      <Link to="/orders" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to orders
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{o.id}</h1>
        <Badge tone={statusTone(o.status)}>{o.status.replace('_', ' ')}</Badge>
        <span className="text-sm text-text-muted">{date(o.createdAt, 'd MMM y, h:mm a')}</span>
      </div>

      {o.allowedNext.length > 0 && (
        <section className="mb-6 flex flex-wrap items-center gap-2 rounded-lg bg-surface-alt p-3" aria-label="Order actions">
          {o.allowedNext.map((next) =>
            next === 'cancelled' ? (
              !confirmCancel ? (
                <Button key={next} variant="danger" size="sm" type="button" onClick={() => setConfirmCancel(true)}>
                  {ACTION_LABEL[next] ?? next}
                </Button>
              ) : (
                <span key={next} className="contents">
                  <Button variant="danger" size="sm" type="button" loading={busy} onClick={() => void advance(next)}>
                    Confirm cancellation
                  </Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setConfirmCancel(false)}>
                    Keep order
                  </Button>
                </span>
              )
            ) : (
              <Button key={next} size="sm" type="button" loading={busy} onClick={() => void advance(next)}>
                {ACTION_LABEL[next] ?? next}
              </Button>
            ),
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="tl">
            <h2 id="tl" className="mb-3 text-lg font-semibold">
              Timeline
            </h2>
            <ol className="space-y-2 border-s-2 border-border ps-4 text-sm">
              {o.timeline.map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.label}</span> <span className="text-text-muted">{t.at ? date(t.at, 'd MMM, h:mm a') : 'Pending'}</span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="it">
            <h2 id="it" className="mb-3 text-lg font-semibold">
              Items
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border px-4">
              {o.lines.map((line) => (
                <li key={line.variantId} className="py-3">
                  <CartLine line={line} compact editable={false} />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="nt">
            <h2 id="nt" className="mb-3 text-lg font-semibold">
              Internal notes
            </h2>
            <form onSubmit={addNote} className="mb-3 flex items-end gap-2" noValidate>
              <div className="flex-1">
                <FormField label="Add a note" error={noteError}>
                  {(f) => <input id={f.id} className={inputClass} maxLength={500} aria-describedby={f.describedBy} aria-invalid={noteError ? 'true' : undefined} value={note} onChange={(e) => setNote(e.target.value)} />}
                </FormField>
              </div>
              <Button type="submit" variant="secondary">
                Add note
              </Button>
            </form>
            <ul className="space-y-2 text-sm">
              {o.notes.map((n) => (
                <li key={n.id} className="rounded-md border border-border p-2">
                  <p>{n.text}</p>
                  <p className="text-xs text-text-muted">
                    {n.author} · {date(n.at, 'd MMM, h:mm a')}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-semibold">Totals</h2>
            <OrderSummary totals={o.totals} promotions={o.promotions} />
            {o.couponCode && <p className="mt-2 text-sm text-text-muted">Coupon {o.couponCode}</p>}
          </section>
          <section className="rounded-lg border border-border p-4 text-sm">
            <h2 className="mb-1 font-semibold">Payment</h2>
            <p>{o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online (Razorpay)'}</p>
            <p className="text-text-muted">{o.paymentStatus.replace('_', ' ')}</p>
          </section>
          <section className="rounded-lg border border-border p-4 text-sm">
            <h2 className="mb-1 font-semibold">Customer</h2>
            <p>{o.contact.name}</p>
            <p className="text-text-muted">
              {o.contact.email} · {o.contact.phone}
            </p>
            <p className="mt-1 text-text-muted">
              {o.address.line1}, {o.address.city}, {o.address.state} {o.address.pincode}
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
