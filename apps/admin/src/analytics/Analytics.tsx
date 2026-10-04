import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, REPORT_DAYS, REPORT_LABEL, type ProductSort, type ReportKey, type ReportSchedule } from '@ecom/contracts';
import { APP_CONFIG, SeoService, ToastService, useDate, useMoney, useResource, useService, useSignal } from '@shop/core';
import { AdminAnalyticsApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Button, EmptyState, ErrorState, FormField, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { downloadText } from '../lib/download';
import { useListParams } from '../lib/list-params';
import { tabClass } from '../layouts/SectionLayout';

const TABS = [
  { label: 'Funnel', link: '/analytics/funnel' },
  { label: 'Products', link: '/analytics/products' },
  { label: 'Search', link: '/analytics/search' },
  { label: 'Campaigns', link: '/analytics/campaigns' },
  { label: 'Cohorts', link: '/analytics/cohorts' },
  { label: 'Scheduled reports', link: '/analytics/reports' },
];

/** Sub-navigation and the look-back period shared by the analytics screens. The period lives in the URL so a report can be bookmarked. */
export function AnalyticsLayout() {
  const list = useListParams();
  const days = list.num('days', 30);
  const { search } = useLocation();
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div>
          <label htmlFor="period" className="mb-1 block text-sm font-medium">
            Period
          </label>
          <select id="period" className={cx(inputClass, '!w-44')} value={days} onChange={(e) => list.patch({ days: e.target.value }, true)}>
            {REPORT_DAYS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>
      </div>
      <nav aria-label="Analytics sections" className="mb-6 flex flex-wrap gap-1 border-b border-border print:hidden">
        {TABS.map((tab) => (
          <NavLink key={tab.link} to={{ pathname: tab.link, search }} className={tabClass}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <p className="mb-4 text-sm text-text-muted">Aggregates over anonymous activity from shoppers who accepted analytics, plus demo data. There is no view of any individual shopper.</p>
      <Outlet />
    </>
  );
}

/** CSV download and print-to-PDF for the report on screen. */
function ExportBar({ report, days }: { report: ReportKey; days: number }) {
  const api = useService(AdminAnalyticsApi);
  const toast = useService(ToastService);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const csv = await firstValueFrom(api.exportCsv(report, days));
      if (typeof URL.createObjectURL !== 'function') return;
      downloadText(`${REPORT_LABEL[report].toLowerCase().replace(/[^a-z]+/g, '-')}-${days}d.csv`, '﻿' + csv);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not export the report.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" size="sm" type="button" loading={busy} onClick={() => void download()}>
        Export CSV
      </Button>
      <Button variant="secondary" size="sm" type="button" onClick={() => window.print()}>
        Print or save as PDF
      </Button>
    </div>
  );
}

const inr = (amount: number) => ({ amount, currency: 'INR' as const });
const PAGE_SIZE = 25;

/** Where shoppers drop off: visitors at each step and the share lost since the step before. */
export function FunnelPage() {
  const api = useService(AdminAnalyticsApi);
  const seo = useService(SeoService);
  const days = useListParams().num('days', 30);
  const resource = useResource(() => api.funnel(days), [api, days]);
  useEffect(() => {
    seo.set({ title: 'Funnel', noindex: true });
  }, [seo]);
  return (
    <>
      <ExportBar report="funnel" days={days} />
      {resource.value ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-start text-sm">
            <caption className="sr-only">Shopping funnel for the last {days} days</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">Step</th>
                <th scope="col" className="p-2 text-end">Visitors</th>
                <th scope="col" className="p-2 text-end">Lost since previous step</th>
                <th scope="col" className="p-2 text-start">Share of first step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resource.value.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="p-2 text-start font-medium">
                    {s.label}
                  </th>
                  <td className="p-2 text-end">{s.visitors}</td>
                  <td className="p-2 text-end">{s.dropOffPercent === null ? '' : s.dropOffPercent + '%'}</td>
                  <td className="p-2">
                    <span className="inline-block h-3 rounded bg-primary align-middle" style={{ width: s.ofFirstPercent * 1.6 }} aria-hidden="true" />
                    <span className="ms-2">{s.ofFirstPercent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

const PRODUCT_COLUMNS: { key: ProductSort; label: string; numeric: boolean }[] = [
  { key: 'title', label: 'Product', numeric: false },
  { key: 'views', label: 'Views', numeric: true },
  { key: 'adds', label: 'Added to cart', numeric: true },
  { key: 'addRatePercent', label: 'Add rate', numeric: true },
  { key: 'units', label: 'Units sold', numeric: true },
  { key: 'revenue', label: 'Item revenue', numeric: true },
  { key: 'sellThroughPercent', label: 'Sell-through', numeric: true },
];

/** Top and slow products: sortable, paginated and exportable. */
export function ProductPerformancePage() {
  const api = useService(AdminAnalyticsApi);
  const seo = useService(SeoService);
  const money = useMoney();
  const list = useListParams();
  const days = list.num('days', 30);
  const sort = (list.str('sort') as ProductSort | undefined) ?? 'units';
  const dir = list.str('dir') === 'asc' ? 'asc' : 'desc';
  const pageNo = list.num('page', 1);
  const resource = useResource(() => api.products({ days, sort, dir, page: pageNo, pageSize: PAGE_SIZE }), [api, days, sort, dir, pageNo]);
  const data = resource.value;
  useEffect(() => {
    seo.set({ title: 'Product performance', noindex: true });
  }, [seo]);
  return (
    <>
      <ExportBar report="products" days={days} />
      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No activity in this period" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[56rem] text-start text-sm">
                <caption className="sr-only">
                  Product performance for the last {days} days, sorted by {sort} {dir === 'asc' ? 'ascending' : 'descending'}
                </caption>
                <thead className="bg-surface-alt">
                  <tr>
                    {PRODUCT_COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className={cx('p-0', c.numeric && 'text-end')} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        <button type="button" className={cx('min-h-11 w-full px-2 font-semibold hover:bg-border', c.numeric ? 'text-end' : 'text-start')} onClick={() => list.patch({ sort: c.key, dir: sort === c.key && dir === 'desc' ? 'asc' : 'desc' })}>
                          {c.label}
                          {sort === c.key && <span aria-hidden="true"> {dir === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="p-2 text-end">In stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((r) => (
                    <tr key={r.productId}>
                      <td className="p-2">
                        <span className="block max-w-xs truncate" title={r.title}>
                          {r.title}
                        </span>
                        <span className="text-xs text-text-muted">{r.productId}</span>
                      </td>
                      <td className="p-2 text-end">{r.views}</td>
                      <td className="p-2 text-end">{r.adds}</td>
                      <td className="p-2 text-end">{r.addRatePercent}%</td>
                      <td className="p-2 text-end">{r.units}</td>
                      <td className="p-2 text-end">{money(inr(r.revenue))}</td>
                      <td className="p-2 text-end">{r.sellThroughPercent}%</td>
                      <td className="p-2 text-end">{r.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} products with activity. Item revenue is units times the price paid, before discounts and shipping.
            </p>
            <div className="mt-4">
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
            </div>
          </>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-64" />
      )}
    </>
  );
}

/** Top searches, searches that find nothing, and click-through. */
export function SearchAnalyticsPage() {
  const api = useService(AdminAnalyticsApi);
  const seo = useService(SeoService);
  const config = useService(APP_CONFIG);
  const days = useListParams().num('days', 30);
  const resource = useResource(() => api.search(days), [api, days]);
  const r = resource.value;
  useEffect(() => {
    seo.set({ title: 'Search analytics', noindex: true });
  }, [seo]);
  /** The shop's own search page for a term. The term is URL-encoded, so it cannot change the path. */
  const searchUrl = (term: string) => `${(config.storefrontUrl ?? '').replace(/\/$/, '')}/search?q=${encodeURIComponent(term)}`;
  return (
    <>
      <ExportBar report="search" days={days} />
      {r ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="top-h">
            <h2 id="top-h" className="mb-2 text-lg font-semibold">
              Top searches
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[26rem] text-start text-sm">
                <caption className="sr-only">Top searches</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Search</th>
                    <th scope="col" className="p-2 text-end">Searches</th>
                    <th scope="col" className="p-2 text-end">Avg results</th>
                    <th scope="col" className="p-2 text-end">Click-through</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.top.length ? (
                    r.top.map((row) => (
                      <tr key={row.term}>
                        <th scope="row" className="p-2 text-start font-normal">
                          {row.term}
                        </th>
                        <td className="p-2 text-end">{row.searches}</td>
                        <td className="p-2 text-end">{row.avgResults}</td>
                        <td className="p-2 text-end">{row.clickThroughPercent}%</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-3 text-text-muted">
                        No searches in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="zero-h">
            <h2 id="zero-h" className="mb-1 text-lg font-semibold">
              Searches with no results
            </h2>
            <p className="mb-2 text-sm text-text-muted">Open one to see exactly what a shopper sees, then fix it with a synonym or by adding the product.</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[22rem] text-start text-sm">
                <caption className="sr-only">Searches with no results</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Search</th>
                    <th scope="col" className="p-2 text-end">Searches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.zeroResults.length ? (
                    r.zeroResults.map((row) => (
                      <tr key={row.term}>
                        <th scope="row" className="p-2 text-start font-normal">
                          <a href={searchUrl(row.term)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {row.term}
                            <span className="sr-only"> (opens the shop's search in a new tab)</span>
                          </a>
                        </th>
                        <td className="p-2 text-end">{row.searches}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="p-3 text-text-muted">
                        Every search found something.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

/** Orders by campaign, first touch and last touch. */
export function CampaignsPage() {
  const api = useService(AdminAnalyticsApi);
  const seo = useService(SeoService);
  const money = useMoney();
  const days = useListParams().num('days', 30);
  const resource = useResource(() => api.campaigns(days), [api, days]);
  useEffect(() => {
    seo.set({ title: 'Campaigns', noindex: true });
  }, [seo]);
  return (
    <>
      <ExportBar report="campaigns" days={days} />
      <p className="mb-3 max-w-2xl text-sm text-text-muted">
        Each order is tagged with the first and the last campaign (from <code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code> in the link) the shopper arrived through, when they accepted analytics. Orders with no campaign count as “direct”.
      </p>
      {resource.value ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-start text-sm">
            <caption className="sr-only">Orders by campaign for the last {days} days</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">Campaign</th>
                <th scope="col" className="p-2 text-end">Orders, first touch</th>
                <th scope="col" className="p-2 text-end">Orders, last touch</th>
                <th scope="col" className="p-2 text-end">Item revenue, last touch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resource.value.length ? (
                resource.value.map((r) => (
                  <tr key={r.campaign}>
                    <th scope="row" className="p-2 text-start font-normal">
                      {r.campaign}
                    </th>
                    <td className="p-2 text-end">{r.firstTouchOrders}</td>
                    <td className="p-2 text-end">{r.lastTouchOrders}</td>
                    <td className="p-2 text-end">{money(inr(r.lastTouchRevenue))}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-3 text-text-muted">
                    No orders in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

/** Weekly buyer cohorts and how many came back. */
export function CohortsPage() {
  const api = useService(AdminAnalyticsApi);
  const seo = useService(SeoService);
  const date = useDate();
  const days = useListParams().num('days', 30);
  const resource = useResource(() => api.cohorts(), [api]);
  useEffect(() => {
    seo.set({ title: 'Cohorts', noindex: true });
  }, [seo]);
  return (
    <>
      <ExportBar report="cohorts" days={days} />
      <p className="mb-3 max-w-2xl text-sm text-text-muted">
        Each row is the group of anonymous visitors who placed their first order that week. The columns show the share of them who ordered again in each following week. Blank cells have not happened yet. The period selector does not apply here.
      </p>
      {resource.value ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-start text-sm">
            <caption className="sr-only">Weekly buyer cohorts and retention</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">First order week</th>
                <th scope="col" className="p-2 text-end">Buyers</th>
                {resource.value.map((_, i) => (
                  <th key={i} scope="col" className="p-2 text-end">
                    Week {i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resource.value.map((row) => (
                <tr key={row.weekStart}>
                  <th scope="row" className="p-2 text-start font-normal">
                    {date(row.weekStart, 'd MMM y')}
                  </th>
                  <td className="p-2 text-end">{row.size}</td>
                  {row.retentionPercent.map((p, i) => (
                    <td key={i} className="p-2 text-end" style={p === null ? undefined : { background: `color-mix(in srgb, var(--color-primary) ${p * 0.4}%, transparent)` }}>
                      {p === null ? '' : p + '%'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

const REPORTS = Object.keys(REPORT_LABEL) as ReportKey[];

/** Scheduled reports. In this demo they are delivered to the mock mailbox; the real backend sends them by email from a scheduled job. */
export function ReportSchedulesPage() {
  const api = useService(AdminAnalyticsApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const user = useSignal(useService(AuthStore).user);
  const resource = useResource(() => api.schedules(), [api]);
  const [report, setReport] = useState<ReportKey>('products');
  const [days, setDays] = useState('30');
  const [frequency, setFrequency] = useState<ReportSchedule['frequency']>('weekly');
  const [recipient, setRecipient] = useState(user?.email ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Scheduled reports', noindex: true });
  }, [seo]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      await firstValueFrom(api.createSchedule({ report, days: Number(days), frequency, recipient }));
      toast.success('Report scheduled.');
      resource.reload();
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? '' : err.message);
      } else setFormError('Could not schedule the report.');
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async (s: ReportSchedule) => {
    try {
      await firstValueFrom(api.sendNow(s.id));
      toast.success(`${REPORT_LABEL[s.report]} sent to ${s.recipient}.`);
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not send the report.');
    }
  };

  const remove = async (s: ReportSchedule) => {
    try {
      await firstValueFrom(api.removeSchedule(s.id));
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not remove the schedule.');
    }
  };

  return (
    <>
      <form className="mb-6 grid max-w-3xl gap-3 sm:grid-cols-5 sm:items-start" onSubmit={create} noValidate aria-label="Schedule a report">
        <FormField label="Report" error={errors['report'] ?? ''}>
          {(f) => (
            <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={report} onChange={(e) => setReport(e.target.value as ReportKey)}>
              {REPORTS.map((k) => (
                <option key={k} value={k}>
                  {REPORT_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Covers" error={errors['days'] ?? ''}>
          {(f) => (
            <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={days} onChange={(e) => setDays(e.target.value)}>
              {REPORT_DAYS.map((n) => (
                <option key={n} value={String(n)}>
                  Last {n} days
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Sent" error={errors['frequency'] ?? ''}>
          {(f) => (
            <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={frequency} onChange={(e) => setFrequency(e.target.value as ReportSchedule['frequency'])}>
              <option value="weekly">Every week</option>
              <option value="daily">Every day</option>
            </select>
          )}
        </FormField>
        <FormField label="Send to" required error={errors['recipient'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} type="email" aria-describedby={f.describedBy} aria-invalid={errors['recipient'] ? 'true' : undefined} value={recipient} onChange={(e) => setRecipient(e.target.value)} />}
        </FormField>
        <div className="sm:pt-6">
          <Button type="submit" loading={saving}>
            Schedule
          </Button>
        </div>
      </form>
      {formError && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {formError}
        </p>
      )}

      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No scheduled reports" description="Schedule one above and it will arrive in the mock mailbox." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[44rem] text-start text-sm">
              <caption className="sr-only">Scheduled reports</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Report</th>
                  <th scope="col" className="p-2 text-start">Sent</th>
                  <th scope="col" className="p-2 text-start">To</th>
                  <th scope="col" className="p-2 text-start">Last sent</th>
                  <th scope="col" className="p-2 text-start">Next</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((s) => (
                  <tr key={s.id}>
                    <td className="p-2">
                      {REPORT_LABEL[s.report]}
                      <span className="block text-xs text-text-muted">last {s.days} days</span>
                    </td>
                    <td className="p-2">{s.frequency === 'daily' ? 'Every day' : 'Every week'}</td>
                    <td className="p-2">{s.recipient}</td>
                    <td className="whitespace-nowrap p-2 text-text-muted">{s.lastRunAt ? date(s.lastRunAt, 'd MMM, h:mm a') : 'Never'}</td>
                    <td className="whitespace-nowrap p-2 text-text-muted">{date(s.nextRunAt, 'd MMM, h:mm a')}</td>
                    <td className="whitespace-nowrap p-2 text-end">
                      <Button size="sm" variant="secondary" type="button" onClick={() => void sendNow(s)}>
                        Send now<span className="sr-only"> {REPORT_LABEL[s.report]}</span>
                      </Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => void remove(s)}>
                        Remove<span className="sr-only"> {REPORT_LABEL[s.report]}</span>
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
