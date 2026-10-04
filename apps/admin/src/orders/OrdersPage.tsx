import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { OrderStatus, PaymentMethod } from '@ecom/contracts';
import { SeoService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminOrderApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, Pagination, Skeleton, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

const STATUSES: OrderStatus[] = ['pending_payment', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

export const statusTone = (s: OrderStatus): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' =>
  ({ pending_payment: 'warning', confirmed: 'primary', packed: 'primary', shipped: 'primary', delivered: 'success', cancelled: 'danger' } as const)[s];

const label = (s: string) => s.replace('_', ' ');

export default function OrdersPage() {
  const api = useService(AdminOrderApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const list = useListParams();
  const q = list.str('q');
  const status = list.str('status') as OrderStatus | undefined;
  const pay = list.str('pay') as PaymentMethod | undefined;
  const from = list.str('from');
  const to = list.str('to');
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Orders', noindex: true });
  }, [seo]);

  const resource = useResource(() => api.list({ q, status, paymentMethod: pay, from, to, page: pageNo, pageSize: 20 }), [api, q, status, pay, from, to, pageNo]);
  const page = resource.value;

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Orders</h1>

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter orders"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
            Order or customer
          </label>
          <input id="q" className={inputClass} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select id="status" className={inputClass} value={status ?? ''} onChange={(e) => list.patch({ status: e.target.value || null })}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pay" className="mb-1 block text-sm font-medium">
            Payment
          </label>
          <select id="pay" className={inputClass} value={pay ?? ''} onChange={(e) => list.patch({ pay: e.target.value || null })}>
            <option value="">All</option>
            <option value="razorpay">Online</option>
            <option value="cod">Cash on delivery</option>
          </select>
        </div>
        <div>
          <label htmlFor="from" className="mb-1 block text-sm font-medium">
            From
          </label>
          <input id="from" className={inputClass} type="date" value={from ?? ''} onChange={(e) => list.patch({ from: e.target.value || null })} />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-sm font-medium">
            To
          </label>
          <input id="to" className={inputClass} type="date" value={to ?? ''} onChange={(e) => list.patch({ to: e.target.value || null })} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {page ? (
        page.items.length === 0 ? (
          <EmptyState title="No orders found" description="Try different filters." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-start text-sm">
                <caption className="sr-only">Orders</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Order</th>
                    <th scope="col" className="p-2 text-start">Date</th>
                    <th scope="col" className="p-2 text-start">Customer</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                    <th scope="col" className="p-2 text-start">Payment</th>
                    <th scope="col" className="p-2 text-end">Items</th>
                    <th scope="col" className="p-2 text-end">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {page.items.map((o) => (
                    <tr key={o.id}>
                      <td className="p-2">
                        <Link to={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                          {o.id}
                        </Link>
                      </td>
                      <td className="p-2 text-text-muted">{date(o.createdAt, 'd MMM y, h:mm a')}</td>
                      <td className="p-2">{o.customerName}</td>
                      <td className="p-2">
                        <Badge tone={statusTone(o.status)}>{label(o.status)}</Badge>
                      </td>
                      <td className="p-2">
                        {o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online'} · {label(o.paymentStatus)}
                      </td>
                      <td className="p-2 text-end">{o.itemCount}</td>
                      <td className="p-2 text-end">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {page.total} orders
            </p>
            <div className="mt-4">
              <Pagination page={page.page} pageSize={page.pageSize} total={page.total} />
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
