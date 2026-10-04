import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, reasonOf, type Disposition, type ReturnStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminReturnApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, FormField, NotFound, Pagination, Skeleton, inputClass, cx, type BadgeTone } from '@shop/ui';
import { useListParams } from '../lib/list-params';

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  picked_up: 'Picked up',
  checked: 'Checked',
  refunded: 'Refunded',
  rejected: 'Rejected',
};

export const returnTone = (status: ReturnStatus): BadgeTone => (status === 'refunded' ? 'success' : status === 'rejected' ? 'danger' : status === 'requested' ? 'warning' : 'primary');

const PAGE_SIZE = 20;
const STATUSES = Object.keys(RETURN_STATUS_LABEL) as ReturnStatus[];
const today = () => new Date().toISOString().slice(0, 10);

/** Returns queue: filter by stage, open one to act on it. */
export function ReturnsQueuePage() {
  const api = useService(AdminReturnApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const list = useListParams();
  const q = list.str('q');
  const status = list.str('status') as ReturnStatus | undefined;
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Return requests', noindex: true });
  }, [seo]);
  const resource = useResource(() => api.list({ q, status, page: pageNo, pageSize: PAGE_SIZE }), [api, q, status, pageNo]);
  const data = resource.value;

  return (
    <>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter return requests"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="rq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="rq" className={inputClass} type="search" placeholder="Return, order, customer or email" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rs" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select id="rs" className={inputClass} value={status ?? ''} onChange={(e) => list.patch({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {RETURN_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No return requests" description="Requests from customers appear here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-start text-sm">
                <caption className="sr-only">Return requests</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Return</th>
                    <th scope="col" className="p-2 text-start">Customer</th>
                    <th scope="col" className="p-2 text-start">Order</th>
                    <th scope="col" className="p-2 text-start">Requested</th>
                    <th scope="col" className="p-2 text-end">Refund</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td className="p-2">
                        <Link to={`/returns/queue/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.id}
                        </Link>
                      </td>
                      <td className="p-2">
                        {r.customerName}
                        <span className="block text-xs text-text-muted">{r.customerEmail}</span>
                      </td>
                      <td className="p-2">
                        <Link to={`/orders/${r.orderId}`} className="hover:underline">
                          {r.orderId}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap p-2 text-text-muted">{date(r.createdAt, 'd MMM y, h:mm a')}</td>
                      <td className="p-2 text-end">{money(r.refund.total)}</td>
                      <td className="p-2">
                        <Badge tone={returnTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} requests
            </p>
            <div className="mt-4">
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
            </div>
          </>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

/** One return: what the customer asked for, the refund the API computed, and the next action for staff. */
export function ReturnDetailPage() {
  const { id = '' } = useParams();
  const api = useService(AdminReturnApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.get(id), [api, id]);
  const r = resource.value;
  const missing = resource.status === 'error' && resource.error instanceof ApiException && resource.error.code === 'not_found';

  const [pickupDate, setPickupDate] = useState(today());
  const [pickupNote, setPickupNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    seo.set({ title: 'Return', noindex: true });
  }, [seo]);

  /** Runs one staff action, showing server field errors beside the inputs and other errors above the page. */
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await action();
      toast.success(done);
      resource.reload();
    } catch (e) {
      if (e instanceof ApiException) {
        setFields(e.fields ?? {});
        if (!e.fields) setError(e.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const setDisposition = (variantId: string, value: string) =>
    setDispositions((d) => {
      const next = { ...d };
      if (value === 'restock' || value === 'scrap') next[variantId] = value;
      else delete next[variantId];
      return next;
    });

  if (missing) return <NotFound />;
  if (!r) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-64" />;

  return (
    <>
      <Link to="/returns/queue" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to returns
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">{r.id}</h2>
        <Badge tone={returnTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
        <span className="text-sm text-text-muted">
          Order{' '}
          <Link to={`/orders/${r.orderId}`} className="text-primary underline">
            {r.orderId}
          </Link>{' '}
          · {r.customerName} ({r.customerEmail})
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger p-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section aria-labelledby="next">
            <h3 id="next" className="mb-3 text-lg font-semibold">
              Next step
            </h3>
            {r.status === 'requested' && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm text-text-muted">Check the refund on the right, then approve with a pickup date or reject with a reason the customer will see.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Pickup date" required error={fields['pickupDate'] ?? ''}>
                    {(f) => <input id={f.id} className={inputClass} type="date" min={today()} value={pickupDate} aria-describedby={f.describedBy} onChange={(e) => setPickupDate(e.target.value)} />}
                  </FormField>
                  <FormField label="Note for the courier" error={fields['note'] ?? ''}>
                    {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} value={pickupNote} onChange={(e) => setPickupNote(e.target.value)} />}
                  </FormField>
                </div>
                <Button type="button" loading={busy} onClick={() => void run(() => firstValueFrom(api.approve(r.id, { pickupDate, note: pickupNote })), 'Return approved and pickup scheduled.')}>
                  Approve and schedule pickup
                </Button>
                <hr className="border-border" />
                <FormField label="Reason for rejecting" error={fields['reason'] ?? ''}>
                  {(f) => <textarea id={f.id} className={inputClass} rows={2} aria-describedby={f.describedBy} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />}
                </FormField>
                <Button variant="danger" type="button" loading={busy} onClick={() => void run(() => firstValueFrom(api.reject(r.id, rejectReason)), 'Return rejected.')}>
                  Reject request
                </Button>
              </div>
            )}
            {r.status === 'approved' && (
              <div className="rounded-lg border border-border p-4">
                <p className="mb-3 text-sm">
                  Pickup scheduled for <strong>{date(r.pickup?.date, 'd MMM y')}</strong>.{r.pickup?.note && <span className="text-text-muted"> {r.pickup.note}</span>}
                </p>
                <Button type="button" loading={busy} onClick={() => void run(() => firstValueFrom(api.markPickedUp(r.id)), 'Marked as picked up.')}>
                  Mark as picked up
                </Button>
              </div>
            )}
            {r.status === 'picked_up' && (
              <form
                className="space-y-4 rounded-lg border border-border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => firstValueFrom(api.recordCheck(r.id, { result: 'accepted', note: checkNote, dispositions })), 'Quality check recorded and stock updated.');
                }}
              >
                <p className="text-sm text-text-muted">Inspect the items. If they pass, decide for each whether it goes back on sale or is scrapped; this writes the stock ledger.</p>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">Condition of each item</legend>
                  {r.items.map((i) => (
                    <div key={i.variantId} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        {i.quantity} × {i.title}
                      </span>
                      <label className="text-sm">
                        <span className="sr-only">Decision for {i.title}</span>
                        <select className={cx(inputClass, '!w-44')} value={dispositions[i.variantId] ?? ''} onChange={(e) => setDisposition(i.variantId, e.target.value)}>
                          <option value="">Choose…</option>
                          <option value="restock">Restock (sellable)</option>
                          <option value="scrap">Scrap (not sellable)</option>
                        </select>
                      </label>
                    </div>
                  ))}
                  {fields['dispositions'] && (
                    <p className="text-sm text-danger" role="alert">
                      {fields['dispositions']}
                    </p>
                  )}
                </fieldset>
                <FormField label="Inspection note" required error={fields['note'] ?? ''}>
                  {(f) => <textarea id={f.id} className={inputClass} rows={2} aria-describedby={f.describedBy} value={checkNote} onChange={(e) => setCheckNote(e.target.value)} />}
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={busy}>
                    Passed: record check
                  </Button>
                  <Button variant="danger" type="button" loading={busy} onClick={() => void run(() => firstValueFrom(api.recordCheck(r.id, { result: 'rejected', note: checkNote })), 'Return rejected after the quality check.')}>
                    Failed: reject the return
                  </Button>
                </div>
              </form>
            )}
            {r.status === 'checked' && (
              <div className="rounded-lg border border-border p-4">
                <p className="mb-3 text-sm">
                  The check passed. Refund <strong>{money(r.refund.total)}</strong> {r.refund.method === 'original' ? 'to the original payment method' : 'as store credit'}.
                </p>
                <Button type="button" loading={busy} onClick={() => void run(() => firstValueFrom(api.refund(r.id)), 'Refund issued.')}>
                  Issue refund
                </Button>
              </div>
            )}
            {r.status === 'refunded' && (
              <p className="rounded-lg border border-success p-4 text-sm" role="status">
                Refunded {date(r.refundedAt, 'd MMM y, h:mm a')}.
              </p>
            )}
            {r.status === 'rejected' && (
              <p className="rounded-lg border border-border p-4 text-sm" role="status">
                Rejected: {r.rejectionReason}
              </p>
            )}
          </section>

          <section aria-labelledby="items">
            <h3 id="items" className="mb-3 text-lg font-semibold">
              Items
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {r.items.map((i) => (
                <li key={i.variantId} className="flex items-center gap-3 p-3">
                  <img src={i.image.url} width={48} height={48} alt="" className="size-12 rounded-md object-cover" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">{i.title}</span>
                    {i.quantity} × {money(i.unitPrice)}
                  </span>
                  {i.disposition && <Badge tone={i.disposition === 'restock' ? 'success' : 'warning'}>{i.disposition === 'restock' ? 'Restocked' : 'Scrapped'}</Badge>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-text-muted">
              Reason: {reasonOf(r.reason)?.label ?? r.reason}
              {r.comments && <> · “{r.comments}”</>}
            </p>
            {r.attachments.length > 0 && <p className="text-sm text-text-muted">Attachments: {r.attachments.map((a) => a.name).join(', ')}</p>}
            {r.check && (
              <p className="text-sm text-text-muted">
                Check: {r.check.result} by {r.check.by}. “{r.check.note}”
              </p>
            )}
          </section>

          <section aria-labelledby="tl">
            <h3 id="tl" className="mb-3 text-lg font-semibold">
              Timeline
            </h3>
            <ol className="space-y-2 border-s-2 border-border ps-4 text-sm">
              {r.timeline.map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.label}</span> <span className="text-text-muted">{date(t.at, 'd MMM, h:mm a')}</span>
                  {t.note && <span className="block text-text-muted">{t.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="rounded-lg border border-border p-4" aria-labelledby="rf">
          <h3 id="rf" className="mb-2 font-semibold">
            Refund (computed)
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd>{money(r.refund.items)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Coupon discount share</dt>
              <dd>− {money(r.refund.discountShare)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Shipping refunded</dt>
              <dd>{money(r.refund.shippingRefund)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Return shipping fee</dt>
              <dd>− {money(r.refund.returnFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{money(r.refund.total)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-text-muted">{r.refund.method === 'original' ? 'To the original payment method' : 'As store credit'}</p>
          <ul className="mt-2 list-disc ps-5 text-xs text-text-muted">
            {r.refund.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Policy at request time: {r.policy.windowDays}-day window, ₹{r.policy.returnFee / 100} fee.
          </p>
        </aside>
      </div>
    </>
  );
}
