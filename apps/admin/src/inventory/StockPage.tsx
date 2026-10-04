import { useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { ApiException, STOCK_REASONS, type AdjustKind, type InventoryFilter, type InventoryRow } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminInventoryApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, FormField, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

const PAGE_SIZE = 20;
type Mode = 'adjust' | 'transfer' | 'policy';

const KIND_LABEL: Record<AdjustKind, string> = { receive: 'Receive stock', return: 'Customer return', damage: 'Damaged or lost (remove)', correction: 'Correction (add or remove)' };
const KINDS: AdjustKind[] = ['receive', 'return', 'damage', 'correction'];
const FILTERS: { value: InventoryFilter; label: string }[] = [
  { value: 'all', label: 'All variants' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'backorder', label: 'Backorder enabled' },
];
const MODES: { value: Mode; label: string }[] = [
  { value: 'adjust', label: 'Adjust stock' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'policy', label: 'Threshold and backorder' },
];

const optionsText = (r: InventoryRow) => Object.values(r.options).join(' / ');

/** Stock on hand, reserved and available per variant, with adjust, transfer and policy tools and the low-stock alerts. */
export default function StockPage() {
  const api = useService(AdminInventoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const q = list.str('q');
  const filter = (list.str('filter') as InventoryFilter | undefined) ?? 'all';
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Stock', noindex: true });
  }, [seo]);

  const resource = useResource(() => api.overview({ q, filter, page: pageNo, pageSize: PAGE_SIZE }), [api, q, filter, pageNo]);
  const alerts = useResource(() => api.alerts(), [api]);
  const locations = useResource(() => api.locations(), [api]).value ?? [];
  const data = resource.value;

  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [mode, setMode] = useState<Mode>('adjust');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adjust, setAdjust] = useState({ locationId: 'loc-main', kind: 'receive' as AdjustKind, quantity: '', reason: '', note: '' });
  const [transfer, setTransfer] = useState({ fromLocationId: 'loc-main', toLocationId: 'loc-blr', quantity: '' });
  const [policy, setPolicy] = useState({ threshold: '', backorder: false, expectedDate: '' });

  const reasons = STOCK_REASONS.filter((r) => r.kinds.includes(adjust.kind));
  const locationSummary = (r: InventoryRow) => locations.map((l) => `${l.name.split(' ')[0]} ${r.byLocation[l.id] ?? 0}`).join(' · ');

  const open = (row: InventoryRow) => {
    setSelected(row);
    setFormError('');
    setErrors({});
    setAdjust({ locationId: 'loc-main', kind: 'receive', quantity: '', reason: '', note: '' });
    setTransfer({ fromLocationId: 'loc-main', toLocationId: 'loc-blr', quantity: '' });
    setPolicy({ threshold: row.customThreshold ? String(row.threshold) : '', backorder: row.backorder, expectedDate: row.expectedDate?.slice(0, 10) ?? '' });
    setMode('adjust');
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setFormError('');
    setErrors({});
    setSaving(true);
    try {
      await action();
      toast.success(success);
      resource.reload();
      alerts.reload();
      setSelected(null);
    } catch (e) {
      if (e instanceof ApiException) {
        setFormError(e.message);
        setErrors(e.fields ?? {});
      } else {
        setFormError('The change could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  const num = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
  const saveAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const f = adjust;
    return run(() => firstValueFrom(api.adjust({ variantId: selected.variantId, locationId: f.locationId, kind: f.kind, quantity: num(f.quantity), reason: f.reason, ...(f.note.trim() ? { note: f.note.trim() } : {}) })), 'Stock change recorded');
  };
  const saveTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const f = transfer;
    return run(() => firstValueFrom(api.transfer({ variantId: selected.variantId, fromLocationId: f.fromLocationId, toLocationId: f.toLocationId, quantity: num(f.quantity) })), 'Stock moved');
  };
  const savePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const threshold = policy.threshold.trim() === '' ? undefined : Number(policy.threshold);
    return run(() => firstValueFrom(api.setPolicy(selected.variantId, { backorder: policy.backorder, ...(threshold !== undefined ? { threshold } : {}), ...(policy.expectedDate ? { expectedDate: policy.expectedDate } : {}) })), 'Policy saved');
  };

  const locationOptions = (row: InventoryRow) =>
    locations.map((l) => (
      <option key={l.id} value={l.id}>
        {l.name} ({row.byLocation[l.id] ?? 0} on hand)
      </option>
    ));

  return (
    <>
      {alerts.value && alerts.value.length > 0 && (
        <section className="mb-4 rounded-lg border border-warning p-3" aria-labelledby="alerts-h">
          <h2 id="alerts-h" className="mb-1 font-semibold">
            Low-stock alerts ({alerts.value.length})
          </h2>
          <p className="mb-2 text-sm text-text-muted">One alert per item until it is restocked above its threshold.</p>
          <ul className="space-y-1 text-sm">
            {alerts.value.slice(0, 5).map((a) => (
              <li key={a.variantId}>
                {a.title} <span className="text-text-muted">({a.sku})</span>: <strong>{a.available}</strong> available, threshold {a.threshold} <span className="text-text-muted">since {date(a.at, 'd MMM, h:mm a')}</span>
              </li>
            ))}
          </ul>
          {alerts.value.length > 5 && <p className="mt-1 text-sm text-text-muted">and {alerts.value.length - 5} more. Use the "Low stock" filter to see them all.</p>}
        </section>
      )}

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter stock"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="sq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="sq" className={inputClass} type="search" placeholder="Product or SKU" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sf" className="mb-1 block text-sm font-medium">
            Show
          </label>
          <select id="sf" className={inputClass} value={filter} onChange={(e) => list.patch({ filter: e.target.value === 'all' ? null : e.target.value })}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {selected && (
        <section className="mb-6 rounded-lg border border-primary p-4" aria-labelledby="ed-h" role="region">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ed-h" className="font-semibold">
                {selected.title}
              </h2>
              <p className="text-sm text-text-muted">
                {selected.sku} · {optionsText(selected)} · on hand {selected.onHand}, reserved {selected.reserved}, available {selected.available}
              </p>
            </div>
            <Button size="sm" variant="ghost" type="button" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <div role="group" aria-label="What to do" className="mb-4 flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={cx('min-h-11 rounded-md border px-3 text-sm font-medium', mode === m.value ? 'border-primary bg-primary text-primary-contrast' : 'border-border-strong hover:bg-surface-alt')}
                aria-pressed={mode === m.value}
                onClick={() => {
                  setMode(m.value);
                  setFormError('');
                  setErrors({});
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {formError && (
            <p className="mb-3 rounded-md border border-danger p-3 text-sm" role="alert">
              {formError}
            </p>
          )}

          {mode === 'adjust' && (
            <form onSubmit={saveAdjust} noValidate className="grid gap-3 md:grid-cols-2" aria-label="Adjust stock">
              <FormField label="Location" error={errors['locationId'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={adjust.locationId} onChange={(e) => setAdjust({ ...adjust, locationId: e.target.value })}>
                    {locationOptions(selected)}
                  </select>
                )}
              </FormField>
              <FormField label="Kind of change">
                {(f) => (
                  <select
                    id={f.id}
                    className={inputClass}
                    value={adjust.kind}
                    onChange={(e) => {
                      const kind = e.target.value as AdjustKind;
                      // A reason that no longer fits the chosen kind must be picked again.
                      const keep = STOCK_REASONS.find((r) => r.code === adjust.reason)?.kinds.includes(kind);
                      setAdjust({ ...adjust, kind, reason: keep ? adjust.reason : '' });
                    }}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Units" required error={errors['quantity'] ?? ''} hint={adjust.kind === 'correction' ? 'Use a minus sign to remove units, e.g. -3.' : 'Whole units.'}>
                {(f) => <input id={f.id} className={inputClass} inputMode="numeric" aria-describedby={f.describedBy} aria-invalid={errors['quantity'] ? 'true' : undefined} value={adjust.quantity} onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })} />}
              </FormField>
              <FormField label="Reason" required error={errors['reason'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={errors['reason'] ? 'true' : undefined} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}>
                    <option value="">Choose a reason</option>
                    {reasons.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Note (optional)" error={errors['note'] ?? ''}>
                  {(f) => <input id={f.id} className={inputClass} maxLength={200} aria-describedby={f.describedBy} value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} />}
                </FormField>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" loading={saving}>
                  Record change
                </Button>
              </div>
            </form>
          )}

          {mode === 'transfer' && (
            <form onSubmit={saveTransfer} noValidate className="grid gap-3 md:grid-cols-3" aria-label="Transfer stock">
              <FormField label="From" error={errors['fromLocationId'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} value={transfer.fromLocationId} onChange={(e) => setTransfer({ ...transfer, fromLocationId: e.target.value })}>
                    {locationOptions(selected)}
                  </select>
                )}
              </FormField>
              <FormField label="To" error={errors['toLocationId'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={transfer.toLocationId} onChange={(e) => setTransfer({ ...transfer, toLocationId: e.target.value })}>
                    {locationOptions(selected)}
                  </select>
                )}
              </FormField>
              <FormField label="Units" required error={errors['quantity'] ?? ''}>
                {(f) => <input id={f.id} className={inputClass} inputMode="numeric" aria-describedby={f.describedBy} aria-invalid={errors['quantity'] ? 'true' : undefined} value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} />}
              </FormField>
              <div className="md:col-span-3">
                <Button type="submit" loading={saving}>
                  Move stock
                </Button>
              </div>
            </form>
          )}

          {mode === 'policy' && (
            <form onSubmit={savePolicy} noValidate className="grid gap-3 md:grid-cols-3" aria-label="Stock policy">
              <FormField label="Low-stock threshold" error={errors['threshold'] ?? ''} hint="Leave empty to use the default.">
                {(f) => <input id={f.id} className={inputClass} inputMode="numeric" aria-describedby={f.describedBy} aria-invalid={errors['threshold'] ? 'true' : undefined} value={policy.threshold} onChange={(e) => setPolicy({ ...policy, threshold: e.target.value })} />}
              </FormField>
              <div className="flex items-end">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5 accent-primary" checked={policy.backorder} onChange={(e) => setPolicy({ ...policy, backorder: e.target.checked })} /> Allow buying at zero stock (backorder)
                </label>
              </div>
              <FormField label="Expected date" error={errors['expectedDate'] ?? ''} hint="Shown to shoppers for backordered items.">
                {(f) => <input id={f.id} className={inputClass} type="date" aria-describedby={f.describedBy} value={policy.expectedDate} onChange={(e) => setPolicy({ ...policy, expectedDate: e.target.value })} />}
              </FormField>
              <div className="md:col-span-3">
                <Button type="submit" loading={saving}>
                  Save policy
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="Nothing matches" description="Try a different search or filter." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[46rem] text-start text-sm">
                <caption className="sr-only">Stock by variant</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Product</th>
                    <th scope="col" className="p-2 text-end">On hand</th>
                    <th scope="col" className="p-2 text-end">Reserved</th>
                    <th scope="col" className="p-2 text-end">Available</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                    <th scope="col" className="p-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((r) => (
                    <tr key={r.variantId}>
                      <th scope="row" className="p-2 text-start font-normal">
                        <span className="block max-w-xs truncate font-medium" title={r.title}>
                          {r.title}
                        </span>
                        <span className="text-xs text-text-muted">
                          {r.sku}
                          {optionsText(r) && <> · {optionsText(r)}</>}
                        </span>
                      </th>
                      <td className="p-2 text-end">
                        {r.onHand}
                        <span className="block text-xs text-text-muted">{locationSummary(r)}</span>
                      </td>
                      <td className="p-2 text-end">{r.reserved}</td>
                      <td className={cx('p-2 text-end font-medium', r.available <= 0 && 'text-danger')}>{r.available}</td>
                      <td className="p-2">
                        {r.available <= 0 && !r.backorder ? <Badge tone="danger">Out of stock</Badge> : r.low ? <Badge tone="warning">Low (≤ {r.threshold})</Badge> : <Badge tone="success">OK</Badge>}
                        {r.backorder && <Badge tone="neutral">Backorder{r.expectedDate ? ' ' + date(r.expectedDate, 'd MMM') : ''}</Badge>}
                      </td>
                      <td className="p-2 text-end">
                        <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => open(r)}>
                          Manage<span className="sr-only"> {r.title} {r.sku}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} variants
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
