import { useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { ApiException, type AdminReviewRow, type AdminUser } from '@ecom/contracts';
import { APP_CONFIG, SeoService, ToastService, useDate, useMoney, useResource, useService, useSignal } from '@shop/core';
import { AdminReviewApi, AdminUserApi, AuditApi, COD_MAX_TOTAL, FREE_SHIPPING_THRESHOLD, MAX_LINE_QUANTITY } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, EmptyState, ErrorState, Pagination, Rating, Skeleton, cx, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

const REVIEW_TONES = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;

/** Reviews held by the automatic checks. Text is shown as plain text (never as HTML). */
export function ReviewsPage() {
  const api = useService(AdminReviewApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const status = (list.str('status') as AdminReviewRow['status'] | undefined) ?? 'pending';
  const pageNo = list.num('page', 1);
  const resource = useResource(() => api.list({ status, page: pageNo, pageSize: 20 }), [api, status, pageNo]);
  const page = resource.value;
  useEffect(() => {
    seo.set({ title: 'Reviews', noindex: true });
  }, [seo]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'The action failed.');
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Review moderation</h1>
      <div className="mb-4">
        <label htmlFor="status" className="mb-1 block text-sm font-medium">
          Show
        </label>
        <select id="status" className={cx(inputClass, '!w-auto')} value={status} onChange={(e) => list.patch({ status: e.target.value || null })}>
          <option value="pending">Waiting for moderation</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {page ? (
        page.items.length === 0 ? (
          <EmptyState title="Nothing here" description="No reviews in this state." />
        ) : (
          <>
            <ul className="space-y-3">
              {page.items.map((r) => (
                <li key={r.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Rating value={r.rating} size={14} />
                    <span className="font-medium">{r.title}</span>
                    <Badge tone={REVIEW_TONES[r.status]}>{r.status}</Badge>
                    {r.flagReason && <Badge tone="warning">{r.flagReason}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{r.body}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {r.author} on “{r.productTitle}” · {date(r.createdAt, 'd MMM y')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status !== 'approved' && (
                      <Button size="sm" type="button" onClick={() => void run(() => firstValueFrom(api.moderate(r.id, 'approved')), 'Review approved')}>
                        Approve<span className="sr-only"> review “{r.title}”</span>
                      </Button>
                    )}
                    {r.status !== 'rejected' && (
                      <Button size="sm" variant="secondary" type="button" onClick={() => void run(() => firstValueFrom(api.moderate(r.id, 'rejected')), 'Review rejected')}>
                        Reject<span className="sr-only"> review “{r.title}”</span>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" type="button" onClick={() => void run(() => firstValueFrom(api.remove(r.id)), 'Review deleted')}>
                      Delete<span className="sr-only"> review “{r.title}”</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {page.total} reviews
            </p>
            <div className="mt-4">
              <Pagination page={page.page} pageSize={page.pageSize} total={page.total} />
            </div>
          </>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}

export function UsersPage() {
  const api = useService(AdminUserApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const me = useSignal(useService(AuthStore).user);
  const resource = useResource(() => api.list(), [api]);
  const [override, setOverride] = useState<AdminUser[] | null>(null);
  const users = override ?? resource.value ?? [];
  useEffect(() => {
    seo.set({ title: 'Users', noindex: true });
  }, [seo]);

  const isAdmin = (u: AdminUser) => u.roles.includes('admin');
  const toggleAdmin = async (u: AdminUser) => {
    const grant = !isAdmin(u);
    try {
      setOverride(await firstValueFrom(api.setRole(u.id, 'admin', grant)));
      toast.success(`${grant ? 'Granted' : 'Revoked'} admin for ${u.name}`);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not change the role.');
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Users</h1>
      {users.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-start text-sm">
            <caption className="sr-only">Users and roles</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">Name</th>
                <th scope="col" className="p-2 text-start">Email</th>
                <th scope="col" className="p-2 text-start">Roles</th>
                <th scope="col" className="p-2 text-end">Orders</th>
                <th scope="col" className="p-2 text-start">Joined</th>
                <th scope="col" className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id}>
                  <th scope="row" className="p-2 text-start font-medium">
                    {u.name}
                  </th>
                  <td className="p-2">
                    {u.email}
                    {!u.emailVerified && <span className="ms-1 text-xs text-warning">(unverified)</span>}
                  </td>
                  <td className="p-2">
                    {u.roles.map((r) => (
                      <span key={r} className="me-1">
                        <Badge tone={r === 'admin' ? 'primary' : 'neutral'}>{r}</Badge>
                      </span>
                    ))}
                  </td>
                  <td className="p-2 text-end">{u.ordersCount}</td>
                  <td className="p-2 text-text-muted">{date(u.createdAt, 'd MMM y')}</td>
                  <td className="p-2 text-end">
                    {u.id !== me?.id ? (
                      <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => void toggleAdmin(u)}>
                        {isAdmin(u) ? 'Revoke admin' : 'Grant admin'}
                        <span className="sr-only"> for {u.name}</span>
                      </button>
                    ) : (
                      <span className="text-xs text-text-muted">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}

export function AuditPage() {
  const api = useService(AuditApi);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const q = list.str('q');
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Audit log', noindex: true });
  }, [seo]);
  const resource = useResource(() => api.list({ q, page: pageNo, pageSize: 20 }), [api, q, pageNo]);
  const page = resource.value;

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Audit log</h1>
      <form
        className="mb-4 flex items-end gap-3"
        role="search"
        aria-label="Search the audit log"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="q" className={inputClass} type="search" placeholder="Who, what or which item" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {page ? (
        page.items.length === 0 ? (
          <EmptyState title="No audit entries" description="Changes made in this console show up here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[40rem] text-start text-sm">
                <caption className="sr-only">Audit log</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">When</th>
                    <th scope="col" className="p-2 text-start">Who</th>
                    <th scope="col" className="p-2 text-start">Action</th>
                    <th scope="col" className="p-2 text-start">Item</th>
                    <th scope="col" className="p-2 text-start">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {page.items.map((a) => (
                    <tr key={a.id}>
                      <td className="p-2 text-text-muted">{date(a.at, 'd MMM y, h:mm a')}</td>
                      <td className="p-2">{a.actor}</td>
                      <td className="p-2 font-mono text-xs">{a.action}</td>
                      <td className="p-2">{a.target}</td>
                      <td className="p-2 text-text-muted">{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {page.total} entries
            </p>
            <div className="mt-4">
              <Pagination page={page.page} pageSize={page.pageSize} total={page.total} />
            </div>
          </>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}

/** Read-only view of how the store is configured (editing settings arrives with the real backend). */
export function SettingsPage() {
  const config = useService(APP_CONFIG);
  const seo = useService(SeoService);
  const money = useMoney();
  useEffect(() => {
    seo.set({ title: 'Settings', noindex: true });
  }, [seo]);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Settings</h1>
      <p className="mb-4 text-sm text-text-muted">Read only. Changing these values needs the backend configuration service.</p>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-border p-4" aria-labelledby="g">
          <h2 id="g" className="mb-2 font-semibold">Store</h2>
          <dl className="space-y-1 text-sm">
            {row('Name', config.siteName)}
            {row('Currency', 'INR (₹)')}
            {row('Data source', config.useMocks ? 'Mock adapters' : 'Live API')}
          </dl>
        </section>
        <section className="rounded-lg border border-border p-4" aria-labelledby="t">
          <h2 id="t" className="mb-2 font-semibold">Tax (GST included in prices)</h2>
          <dl className="space-y-1 text-sm">
            {row('Grocery', '5%')}
            {row('Books', '0%')}
            {row('Fashion', '12%')}
            {row('Everything else', '18%')}
          </dl>
        </section>
        <section className="rounded-lg border border-border p-4" aria-labelledby="s">
          <h2 id="s" className="mb-2 font-semibold">Shipping</h2>
          <dl className="space-y-1 text-sm">
            {row('Standard', `₹49, free from ${money({ amount: FREE_SHIPPING_THRESHOLD, currency: 'INR' })}`)}
            {row('Express', '₹99')}
            {row('Max quantity per item', MAX_LINE_QUANTITY)}
          </dl>
        </section>
        <section className="rounded-lg border border-border p-4" aria-labelledby="p">
          <h2 id="p" className="mb-2 font-semibold">Payments</h2>
          <dl className="space-y-1 text-sm">
            {row('Online', 'Razorpay (test mode)')}
            {row('Cash on delivery', `Up to ${money({ amount: COD_MAX_TOTAL, currency: 'INR' })}`)}
          </dl>
        </section>
      </div>
    </>
  );
}
