import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, REC_STRATEGY_LABEL, TICKET_STATUS_LABEL, type RecConfig, type RecPreview, type RecStrategy, type TicketStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService, useSignal } from '@shop/core';
import { AdminRecommendationApi, AdminSupportApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, EmptyState, ErrorState, FormField, NotFound, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

const STRATEGIES = Object.keys(REC_STRATEGY_LABEL) as RecStrategy[];
const ids = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** Recommendation controls: switch strategies off, pin, exclude or boost products, and preview the result. Changes apply on the next page load, with no deploy. */
export function RecommendationsPage() {
  const api = useService(AdminRecommendationApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const config = useResource(() => api.config(), [api]);
  const stats = useResource(() => api.stats(), [api]).value;

  const [enabled, setEnabled] = useState<Record<RecStrategy, boolean>>({ similar: true, bought_together: true, trending: true, best_sellers: true, personalised: true });
  const [pinned, setPinned] = useState('');
  const [excluded, setExcluded] = useState('');
  const [boosts, setBoosts] = useState('');
  const [minTogether, setMinTogether] = useState('2');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState<RecPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Recommendations', noindex: true });
  }, [seo]);
  useEffect(() => {
    const c: RecConfig | undefined = config.value;
    if (!c) return;
    setEnabled({ ...c.strategies });
    setPinned(c.pinned.join('\n'));
    setExcluded(c.excluded.join('\n'));
    setBoosts(
      Object.entries(c.boosts)
        .map(([id, f]) => `${id} ${f}`)
        .join('\n'),
    );
    setMinTogether(String(c.minTogether));
  }, [config.value]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const boostMap: Record<string, number> = {};
    for (const line of boosts.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [id, factor] = line.split(/[\s,]+/);
      boostMap[id] = Number(factor);
    }
    setSaving(true);
    try {
      await firstValueFrom(api.saveConfig({ strategies: enabled, pinned: ids(pinned), excluded: ids(excluded), boosts: boostMap, minTogether: Number(minTogether) }));
      toast.success('Recommendation rules saved. They apply to the next page load.');
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? 'Please check the highlighted fields.' : err.message);
      } else setFormError('Could not save the rules.');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setPreviewing(true);
    try {
      setPreview(await firstValueFrom(api.preview(previewId.trim() || undefined)));
    } finally {
      setPreviewing(false);
    }
  };

  const area = (label: string, hint: string, value: string, set: (v: string) => void, key: string, rows: number) => (
    <FormField label={label} hint={hint} error={errors[key] ?? ''}>
      {(f) => <textarea id={f.id} className={inputClass} rows={rows} aria-describedby={f.describedBy} aria-invalid={errors[key] ? 'true' : undefined} value={value} onChange={(e) => set(e.target.value)} />}
    </FormField>
  );

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Recommendations</h1>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">Every row is built from simple rules over anonymous activity (views, carts, purchases), so each product can say why it was chosen. Use these controls to steer them.</p>

      {stats && (
        <dl className="mb-6 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Event data">
          {[
            ['Events', stats.events],
            ['Last 7 days', stats.last7Days],
            ['Anonymous visitors', stats.visitors],
            ['Purchases', stats.byName['purchase'] ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {config.value ? (
        <form className="max-w-2xl space-y-5" onSubmit={save} noValidate>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Strategies</legend>
            <ul>
              {STRATEGIES.map((s) => (
                <li key={s}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5 accent-primary" checked={enabled[s]} onChange={(e) => setEnabled((cur) => ({ ...cur, [s]: e.target.checked }))} />
                    {REC_STRATEGY_LABEL[s]}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {area('Pinned product ids', 'Shown first wherever they fit. One per line or comma separated.', pinned, setPinned, 'pinned', 2)}
          {area('Excluded product ids', 'Never recommended.', excluded, setExcluded, 'excluded', 2)}
          {area('Boosts', 'One per line: product id, then a multiplier from 0.1 to 10. Example: p-0003 2', boosts, setBoosts, 'boosts', 3)}
          <FormField label="Orders needed to count as “bought together”" error={errors['minTogether'] ?? ''}>
            {(f) => <input id={f.id} className={inputClass} inputMode="numeric" aria-describedby={f.describedBy} aria-invalid={errors['minTogether'] ? 'true' : undefined} value={minTogether} onChange={(e) => setMinTogether(e.target.value)} />}
          </FormField>
          {formError && (
            <p className="text-sm text-danger" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" loading={saving}>
            Save rules
          </Button>
        </form>
      ) : (
        <Skeleton className="h-64 max-w-2xl" />
      )}

      <section className="mt-10 max-w-3xl" aria-labelledby="preview-h">
        <h2 id="preview-h" className="mb-2 text-lg font-semibold">
          Preview
        </h2>
        <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={runPreview}>
          <FormField label="Product id" hint="Empty previews the home page for a brand-new visitor">
            {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} value={previewId} onChange={(e) => setPreviewId(e.target.value)} />}
          </FormField>
          <Button variant="secondary" type="submit" loading={previewing}>
            Preview rows
          </Button>
        </form>
        {preview && (
          <>
            {preview.rows.length === 0 && (
              <p className="text-sm text-text-muted" role="status">
                No rows: the data is too thin, or every strategy for this view is off.
              </p>
            )}
            {preview.rows.map((row) => (
              <section key={row.strategy} className="mb-4 rounded-lg border border-border p-3" aria-label={row.title}>
                <h3 className="font-semibold">
                  {row.title}
                  {row.coldStart && <span className="ms-2 text-xs font-normal text-text-muted">(cold start)</span>}
                </h3>
                <p className="mb-2 text-sm text-text-muted">{row.subtitle}</p>
                <ol className="list-decimal space-y-0.5 ps-5 text-sm">
                  {row.items.map((item) => (
                    <li key={item.product.id}>
                      {item.product.title}{' '}
                      <span className="text-xs text-text-muted">
                        ({item.product.id}) · {item.reason}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </section>
    </>
  );
}

const PAGE_SIZE = 20;
const STATUSES: TicketStatus[] = ['open', 'pending', 'closed'];
const ticketTone = (s: TicketStatus) => (s === 'closed' ? 'neutral' : s === 'pending' ? 'primary' : 'warning');

/** Support queue: filter by status and assignee, open one to reply. */
export function SupportQueuePage() {
  const api = useService(AdminSupportApi);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const q = list.str('q');
  const status = list.str('status') as TicketStatus | undefined;
  const assignee = list.str('assignee') as 'me' | 'none' | undefined;
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Support', noindex: true });
  }, [seo]);
  const resource = useResource(() => api.list({ q, status, assignee, page: pageNo, pageSize: PAGE_SIZE }), [api, q, status, assignee, pageNo]);
  const data = resource.value;

  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">Support</h1>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter tickets"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="sq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="sq" className={inputClass} type="search" placeholder="Ticket, subject, customer or order" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ss" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select id="ss" className={inputClass} value={status ?? ''} onChange={(e) => list.patch({ status: e.target.value || null })}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sa" className="mb-1 block text-sm font-medium">
            Assignee
          </label>
          <select id="sa" className={inputClass} value={assignee ?? ''} onChange={(e) => list.patch({ assignee: e.target.value || null })}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No tickets" description="Customer questions appear here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-start text-sm">
                <caption className="sr-only">Support tickets</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Subject</th>
                    <th scope="col" className="p-2 text-start">Customer</th>
                    <th scope="col" className="p-2 text-start">Order</th>
                    <th scope="col" className="p-2 text-start">Assignee</th>
                    <th scope="col" className="p-2 text-start">Updated</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((t) => (
                    <tr key={t.id}>
                      <td className="p-2">
                        <Link to={`/support/${t.id}`} className="font-medium text-primary hover:underline">
                          {t.subject}
                        </Link>
                        <span className="block text-xs text-text-muted">{t.id}</span>
                      </td>
                      <td className="p-2">{t.customerName}</td>
                      <td className="p-2">{t.orderId ?? ''}</td>
                      <td className="p-2">{t.assignee ?? 'Unassigned'}</td>
                      <td className="whitespace-nowrap p-2 text-text-muted">{date(t.updatedAt, 'd MMM, h:mm a')}</td>
                      <td className="p-2">
                        <Badge tone={ticketTone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} tickets
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

/** One ticket: the conversation, a reply box, assignment and status. */
export function SupportDetailPage() {
  const { id = '' } = useParams();
  const api = useService(AdminSupportApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const me = useSignal(useService(AuthStore).user)?.name ?? '';
  const resource = useResource(() => api.get(id), [api, id]);
  const t = resource.value;
  const missing = resource.status === 'error' && resource.error instanceof ApiException && resource.error.code === 'not_found';
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Support ticket', noindex: true });
  }, [seo]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await firstValueFrom(api.reply(id, { message: reply }));
      setReply('');
      toast.success('Reply sent to the customer.');
      resource.reload();
    } catch (err) {
      setError(err instanceof ApiException ? (err.fields?.['message'] ?? err.message) : 'Could not send the reply.');
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'That did not work. Please try again.');
    }
  };

  if (missing) return <NotFound />;
  if (!t) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-64 max-w-2xl" />;
  return (
    <>
      <Link to="/support" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to support
      </Link>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t.subject}</h1>
        <Badge tone={ticketTone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>
      </div>
      <p className="mb-4 text-sm text-text-muted">
        {t.id} · {t.customerName} ({t.customerEmail})
        {t.orderId && (
          <>
            {' '}
            · Order{' '}
            <Link to={`/orders/${t.orderId}`} className="text-primary underline">
              {t.orderId}
            </Link>
          </>
        )}{' '}
        · Assigned to {t.assignee ?? 'nobody'}
      </p>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Ticket actions">
        {t.assignee !== me && (
          <Button size="sm" variant="secondary" type="button" onClick={() => void act(() => firstValueFrom(api.assign(t.id, me)))}>
            Assign to me
          </Button>
        )}
        {t.assignee && (
          <Button size="sm" variant="ghost" type="button" onClick={() => void act(() => firstValueFrom(api.assign(t.id, null)))}>
            Unassign
          </Button>
        )}
        {t.status === 'closed' ? (
          <Button size="sm" variant="secondary" type="button" onClick={() => void act(() => firstValueFrom(api.setStatus(t.id, 'open')))}>
            Reopen
          </Button>
        ) : (
          <Button size="sm" variant="secondary" type="button" onClick={() => void act(() => firstValueFrom(api.setStatus(t.id, 'closed')))}>
            Close ticket
          </Button>
        )}
      </div>

      <ol className="mb-6 max-w-2xl space-y-3" aria-label="Messages">
        {t.messages.map((m) => (
          <li key={m.id} className={cx('rounded-lg border p-3', m.author === 'staff' ? 'border-primary' : 'border-border')}>
            <p className="mb-1 flex justify-between text-sm">
              <strong>
                {m.authorName} <span className="font-normal text-text-muted">({m.author === 'staff' ? 'staff' : 'customer'})</span>
              </strong>
              <time dateTime={m.at} className="text-text-muted">
                {date(m.at, 'd MMM y, h:mm a')}
              </time>
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
            {m.attachments.length > 0 && <p className="mt-1 text-sm text-text-muted">Attached: {m.attachments.map((f) => f.name).join(', ')}</p>}
          </li>
        ))}
      </ol>

      {t.status !== 'closed' && (
        <form className="max-w-2xl space-y-3" onSubmit={send} noValidate>
          <FormField label="Reply to the customer" error={error}>
            {(f) => <textarea id={f.id} className={inputClass} rows={4} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} value={reply} onChange={(e) => setReply(e.target.value)} />}
          </FormField>
          <Button type="submit" loading={saving}>
            Send reply
          </Button>
        </form>
      )}
    </>
  );
}
