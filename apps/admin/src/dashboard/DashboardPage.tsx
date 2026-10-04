import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatMoney } from '@ecom/contracts';
import { SeoService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminDashboardApi } from '@shop/data-access';
import { Badge, ErrorState, Skeleton, cx, inputClass } from '@shop/ui';

interface Day {
  date: string;
  revenue: number;
  orders: number;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
const inr = (amount: number) => formatMoney({ amount, currency: 'INR' });

/** Revenue-per-day bar chart with a text summary and a table alternative for screen readers and keyboard users. */
export function RevenueChart({ data }: { data: Day[] }) {
  const date = useDate();
  const money = useMoney();
  const baseline = H - PAD.bottom;
  const peak = Math.max(0, ...data.map((d) => d.revenue));
  const bars = useMemo(() => {
    const inner = W - PAD.left - PAD.right;
    const slot = inner / Math.max(1, data.length);
    const width = Math.max(2, slot * 0.7);
    const max = peak || 1;
    const usable = H - PAD.top - PAD.bottom;
    return data.map((d, i) => {
      const height = (d.revenue / max) * usable;
      return { date: d.date, x: PAD.left + i * slot + (slot - width) / 2, y: H - PAD.bottom - height, width, height, label: `${d.date}: ${inr(d.revenue)}, ${d.orders} orders` };
    });
  }, [data, peak]);

  const total = data.reduce((s, d) => s + d.revenue, 0);
  const best = data.reduce((a, b) => (b.revenue > a.revenue ? b : a), data[0] ?? { date: '', revenue: 0, orders: 0 });
  const summary = `Bar chart of revenue per day over ${data.length} days. Total ${inr(total)}. Best day ${best.date} with ${inr(best.revenue)}.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
        <line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} className="stroke-border-strong" strokeWidth="1" />
        {bars.map((bar) => (
          <rect key={bar.date} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx="2" className="fill-primary">
            <title>{bar.label}</title>
          </rect>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-text-muted text-[11px]">
          {date(data[0]?.date, 'd MMM')}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-text-muted text-[11px]">
          {date(data[data.length - 1]?.date, 'd MMM')}
        </text>
        <text x={W - PAD.right} y={PAD.top + 8} textAnchor="end" className="fill-text-muted text-[11px]">
          Peak {inr(peak)}
        </text>
      </svg>
      <details className="mt-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">View as table</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-start">
            <caption className="sr-only">Revenue and orders per day</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1 text-start">Date</th>
                <th scope="col" className="py-1 text-end">Orders</th>
                <th scope="col" className="py-1 text-end">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-b border-border">
                  <th scope="row" className="py-1 text-start font-normal">{date(d.date, 'd MMM y')}</th>
                  <td className="py-1 text-end">{d.orders}</td>
                  <td className="py-1 text-end">{money({ amount: d.revenue, currency: 'INR' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function DashboardPage() {
  const api = useService(AdminDashboardApi);
  const seo = useService(SeoService);
  const money = useMoney();
  const [days, setDays] = useState(30);
  const metrics = useResource(() => api.metrics(days), [api, days]);
  const m = metrics.value;
  useEffect(() => {
    seo.set({ title: 'Dashboard', noindex: true });
  }, [seo]);

  const card = 'rounded-lg border border-border p-4';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div>
          <label htmlFor="period" className="sr-only">
            Period
          </label>
          <select id="period" className={cx(inputClass, '!w-auto')} value={days} onChange={(e) => setDays(+e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {m ? (
        <>
          <section aria-label="Key figures" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className="text-sm text-text-muted">Revenue</p>
              <p className="text-2xl font-bold">{money(m.revenue)}</p>
            </div>
            <div className={card}>
              <p className="text-sm text-text-muted">Orders</p>
              <p className="text-2xl font-bold">{m.orders}</p>
            </div>
            <div className={card}>
              <p className="text-sm text-text-muted">Average order value</p>
              <p className="text-2xl font-bold">{money(m.averageOrderValue)}</p>
            </div>
            <div className={card}>
              <p className="text-sm text-text-muted">New customers</p>
              <p className="text-2xl font-bold">{m.newCustomers}</p>
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-border p-4" aria-labelledby="rev">
            <h2 id="rev" className="mb-2 font-semibold">
              Revenue by day
            </h2>
            <RevenueChart data={m.byDay} />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-lg border border-border p-4" aria-labelledby="st">
              <h2 id="st" className="mb-2 font-semibold">
                Orders by status
              </h2>
              <ul className="space-y-1 text-sm">
                {m.statusBreakdown.map((s) => (
                  <li key={s.status} className="flex items-center justify-between">
                    <Badge>{s.status.replace('_', ' ')}</Badge>
                    <span>{s.count}</span>
                  </li>
                ))}
              </ul>
              <Link to="/orders" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
                View all orders
              </Link>
            </section>

            <section className="rounded-lg border border-border p-4" aria-labelledby="tp">
              <h2 id="tp" className="mb-2 font-semibold">
                Top products
              </h2>
              <ol className="space-y-2 text-sm">
                {m.topProducts.map((p) => (
                  <li key={p.title} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate" title={p.title}>
                      {p.title}
                    </span>
                    <span className="shrink-0 text-text-muted">
                      {p.units} sold · {money(p.revenue)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-lg border border-border p-4" aria-labelledby="ls">
              <h2 id="ls" className="mb-2 font-semibold">
                Low stock
              </h2>
              {m.lowStock.length === 0 ? (
                <p className="text-sm text-text-muted">Nothing running low.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {m.lowStock.map((v) => (
                    <li key={v.sku} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate" title={v.title}>
                        {v.title} <span className="text-text-muted">({v.sku})</span>
                      </span>
                      <Badge tone={v.stock === 0 ? 'danger' : 'warning'}>{v.stock} left</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/inventory/stock?filter=low" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
                Manage stock
              </Link>
            </section>
          </div>
        </>
      ) : metrics.status === 'error' ? (
        <ErrorState onRetry={metrics.reload} />
      ) : (
        <Skeleton className="h-40" />
      )}
    </>
  );
}
