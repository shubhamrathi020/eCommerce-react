import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { catchError, firstValueFrom, of } from 'rxjs';
import { ApiException, type Order } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService, useSignal } from '@shop/core';
import { OrderApi, ReturnApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, ButtonLink, CartLine, EmptyState, ErrorState, NotFound, OrderSummary, Skeleton, cx } from '@shop/ui';

const PAYMENT_TEXT: Record<Order['paymentStatus'], string> = {
  pending: 'Awaiting payment',
  paid: 'Paid online',
  failed: 'Payment failed',
  cod: 'Pay on delivery',
  refund_pending: 'Refund in progress',
};
const STATUS_LABEL: Record<Order['status'], string> = { pending_payment: 'Awaiting payment', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const SHIPMENT_LABEL: Record<string, string> = { confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const statusTone = (status: string) => (status === 'cancelled' ? 'danger' : status === 'delivered' ? 'success' : 'primary');

/** Orders placed on this device. */
export function OrdersListPage() {
  const api = useService(OrderApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.list(), [api]);
  const orders = resource.value ?? [];
  useEffect(() => {
    seo.set({ title: 'Your orders', noindex: true, path: '/orders' });
  }, [seo]);
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Your orders</h1>
      {resource.loading && !resource.value ? (
        <Skeleton className="h-24" />
      ) : orders.length === 0 ? (
        <EmptyState title="No orders yet" description="Orders you place on this device show up here.">
          <ButtonLink to="/">Start shopping</ButtonLink>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4 hover:bg-surface-alt">
                <span>
                  <span className="block font-medium">{o.id}</span>
                  <span className="block text-sm text-text-muted">
                    {date(o.createdAt, 'd MMM y')} · {o.totals.itemCount} item(s)
                  </span>
                </span>
                <Badge tone={statusTone(o.status)}>{o.status.replace('_', ' ')}</Badge>
                <span className="font-semibold">{money(o.totals.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Order confirmation and tracking. Reachable by the (unguessable) order id, so guests can revisit it. */
export function OrderPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const placed = params.get('placed');
  const api = useService(OrderApi);
  const returns = useService(ReturnApi);
  const auth = useService(AuthStore);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const user = useSignal(auth.user);

  const resource = useResource(() => api.get(id), [api, id]);
  const o = resource.value;
  const notFound = resource.status === 'error' && !o && resource.error instanceof ApiException && resource.error.code === 'not_found';
  const isOwner = !!user && !!o?.userId && o.userId === user.id;

  // Where the money of a cancelled, prepaid order is. Not needed for guests or other orders.
  const wantRefund = o?.paymentStatus === 'refund_pending' && isOwner;
  const refund = useResource(() => returns.orderRefund(id).pipe(catchError(() => of(null))), [returns, id, wantRefund], wantRefund);

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    seo.set({ title: 'Your order', noindex: true });
  }, [seo]);

  // Mock orders move through packing and shipping on their own; poll so the timeline updates.
  const status = o?.status;
  const { reload } = resource;
  useEffect(() => {
    if (!status || status === 'delivered' || status === 'cancelled' || status === 'pending_payment') return;
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [status, reload]);

  const cancel = async (order: Order) => {
    setCancelling(true);
    try {
      await firstValueFrom(api.cancel(order.id));
      toast.success('Your order was cancelled.');
      reload();
    } catch (error) {
      toast.error(error instanceof ApiException ? error.message : 'Could not cancel this order.');
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  };

  if (notFound) return <NotFound />;
  if (!o) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-40" />;

  const shipmentItems = (s: { variantIds: string[] }) =>
    o.lines
      .filter((l) => s.variantIds.includes(l.variantId))
      .map((l) => `${l.quantity} × ${l.title}`)
      .join(', ');
  const canCancel = o.status === 'confirmed' || o.status === 'packed' || o.status === 'pending_payment';
  const refundedAt = refund.value?.refundedAt;

  return (
    <>
      {placed ? (
        <div className="mb-4 rounded-lg border border-success p-4" role="status">
          <h1 className="text-xl font-bold text-success">Thank you! Your order is placed.</h1>
          <p className="text-sm text-text-muted">A confirmation was sent to {o.contact.email}.</p>
        </div>
      ) : (
        <h1 className="mb-4 text-2xl font-bold md:text-3xl">Order {o.id}</h1>
      )}
      <p className="mb-4 text-sm text-text-muted">
        Order <strong className="text-text">{o.id}</strong> · placed {date(o.createdAt, 'd MMM y, h:mm a')} · <Badge tone={statusTone(o.status)}>{STATUS_LABEL[o.status]}</Badge>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="tl">
            <h2 id="tl" className="mb-3 text-lg font-semibold">
              Tracking
            </h2>
            <ol className="space-y-3 border-s-2 border-border ps-4">
              {o.timeline.map((step) => (
                <li key={step.status} className="relative">
                  <span className={cx('absolute -start-[1.4rem] top-1 size-3 rounded-full', step.at ? (step.status === 'cancelled' ? 'bg-danger' : 'bg-success') : 'bg-border-strong')} aria-hidden="true" />
                  <p className={step.at ? 'font-medium' : 'text-text-muted'}>{step.label}</p>
                  <p className="text-sm text-text-muted">{step.at ? date(step.at, 'd MMM, h:mm a') : 'Pending'}</p>
                </li>
              ))}
            </ol>
          </section>

          {o.shipments && o.shipments.length > 0 && (
            <section aria-labelledby="shipments">
              <h2 id="shipments" className="mb-1 text-lg font-semibold">
                Shipments
              </h2>
              <p className="mb-3 text-sm text-text-muted">Your order ships in {o.shipments.length} parts. Each seller sends and tracks their own.</p>
              <ul className="space-y-3">
                {o.shipments.map((s) => (
                  <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <strong>From {s.sellerName}</strong> <Badge tone={statusTone(s.status)}>{SHIPMENT_LABEL[s.status] ?? s.status}</Badge>
                    </p>
                    <p className="text-text-muted">{shipmentItems(s)}</p>
                    {s.trackingNumber && (
                      <p>
                        Tracking number: <span className="font-mono">{s.trackingNumber}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="items">
            <h2 id="items" className="mb-3 text-lg font-semibold">
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
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border p-4" aria-labelledby="sum">
            <h2 id="sum" className="mb-3 font-semibold">
              Summary
            </h2>
            <OrderSummary totals={o.totals} promotions={o.promotions} />
            <p className="mt-3 text-sm text-text-muted">{PAYMENT_TEXT[o.paymentStatus]}</p>
            {o.paymentStatus === 'refund_pending' &&
              (refundedAt ? (
                <p className="mt-1 text-sm text-success" role="status">
                  Refunded to your original payment method on {date(refundedAt, 'd MMM y')}.
                </p>
              ) : (
                <p className="mt-1 text-sm text-text-muted">Your refund will be returned to the original payment method.</p>
              ))}
          </section>
          <section className="rounded-lg border border-border p-4 text-sm" aria-labelledby="addr">
            <h2 id="addr" className="mb-1 font-semibold">
              Delivery address
            </h2>
            <p>
              {o.contact.name}, {o.contact.phone}
            </p>
            <p className="text-text-muted">
              {o.address.line1}
              {o.address.line2 ? ', ' + o.address.line2 : ''}, {o.address.city}, {o.address.state} {o.address.pincode}
            </p>
          </section>
          <div className="flex flex-wrap gap-2 print:hidden">
            <ButtonLink variant="secondary" to={`/orders/${o.id}/invoice`}>
              View invoice
            </ButtonLink>
            {isOwner && (
              <>
                {o.status === 'delivered' && (
                  <ButtonLink variant="secondary" to={`/account/returns/new?order=${o.id}`}>
                    Return items
                  </ButtonLink>
                )}
                <ButtonLink variant="ghost" to={`/account/support/new?order=${o.id}`}>
                  Get help
                </ButtonLink>
              </>
            )}
            {canCancel &&
              (confirmingCancel ? (
                <>
                  <Button variant="danger" type="button" loading={cancelling} onClick={() => void cancel(o)}>
                    Yes, cancel order
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setConfirmingCancel(false)}>
                    Keep order
                  </Button>
                </>
              ) : (
                <Button variant="ghost" type="button" onClick={() => setConfirmingCancel(true)}>
                  Cancel order
                </Button>
              ))}
          </div>
        </aside>
      </div>
    </>
  );
}

/** Printable tax invoice (use the browser's "Save as PDF"). The site header and footer are hidden when printing. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const api = useService(OrderApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.get(id), [api, id]);
  const o = resource.value;
  useEffect(() => {
    seo.set({ title: 'Invoice', noindex: true });
  }, [seo]);

  if (!o) return resource.status === 'error' ? <NotFound /> : <Skeleton className="h-64" />;
  return (
    <>
      <div className="mb-4 flex gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
        <ButtonLink variant="secondary" to={`/orders/${o.id}`}>
          Back to order
        </ButtonLink>
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border border-border bg-surface p-6 print:border-0 print:p-0" aria-label="Tax invoice">
        <header className="flex flex-wrap justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-bold">Tax Invoice</h1>
            <p className="text-sm text-text-muted">Shop (demo seller) · GSTIN 29ABCDE1234F1Z5 (sample)</p>
          </div>
          <dl className="text-sm">
            <div className="flex gap-2">
              <dt className="text-text-muted">Invoice no.</dt>
              <dd>INV-{o.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted">Date</dt>
              <dd>{date(o.createdAt, 'd MMM y')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted">Payment</dt>
              <dd>{o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online'}</dd>
            </div>
          </dl>
        </header>
        <section className="py-4 text-sm" aria-label="Bill to">
          <h2 className="font-semibold">Bill to</h2>
          <p>
            {o.contact.name} · {o.contact.email} · {o.contact.phone}
          </p>
          <p className="text-text-muted">
            {o.address.line1}
            {o.address.line2 ? ', ' + o.address.line2 : ''}, {o.address.city}, {o.address.state} {o.address.pincode}
          </p>
        </section>
        <table className="w-full text-start text-sm">
          <caption className="sr-only">Invoice items</caption>
          <thead>
            <tr className="border-y border-border">
              <th scope="col" className="py-2 text-start">Item</th>
              <th scope="col" className="py-2 text-end">Qty</th>
              <th scope="col" className="py-2 text-end">Unit price</th>
              <th scope="col" className="py-2 text-end">GST incl.</th>
              <th scope="col" className="py-2 text-end">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {o.lines.map((line) => (
              <tr key={line.variantId}>
                <td className="py-2">
                  {line.title}
                  <span className="block text-text-muted">{line.brandName}</span>
                </td>
                <td className="py-2 text-end">{line.quantity}</td>
                <td className="py-2 text-end">{money(line.unitPrice)}</td>
                <td className="py-2 text-end">{money(line.taxIncluded)}</td>
                <td className="py-2 text-end">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ms-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(o.totals.subtotal)}</dd>
          </div>
          {(o.promotions ?? []).map((offer) => (
            <div key={offer.promotionId} className="flex justify-between">
              <dt>{offer.name}</dt>
              <dd>−{money(offer.amount)}</dd>
            </div>
          ))}
          {o.totals.couponDiscount.amount > 0 && (
            <div className="flex justify-between">
              <dt>Coupon {o.couponCode}</dt>
              <dd>−{money(o.totals.couponDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd>{o.totals.shipping.amount === 0 ? 'Free' : money(o.totals.shipping)}</dd>
          </div>
          {o.totals.giftCardApplied && (
            <div className="flex justify-between">
              <dt>Paid with gift card</dt>
              <dd>−{money(o.totals.giftCardApplied)}</dd>
            </div>
          )}
          {o.totals.creditApplied && (
            <div className="flex justify-between">
              <dt>Paid with store credit</dt>
              <dd>−{money(o.totals.creditApplied)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
            <dt>{o.tender ? 'Amount due' : 'Total'}</dt>
            <dd>{money(o.totals.total)}</dd>
          </div>
          <div className="flex justify-between text-text-muted">
            <dt>GST included in total</dt>
            <dd>{money(o.totals.taxIncluded)}</dd>
          </div>
        </dl>
        <p className="mt-6 text-xs text-text-muted">This is a system generated demo invoice.</p>
      </article>
    </>
  );
}
