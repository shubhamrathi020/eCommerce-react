import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, PROMOTION_KIND_LABEL, SEGMENT_LABEL, type Promotion, type PromotionInput, type Segment, type StackingMode } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminPromotionApi, CategoryApi } from '@shop/data-access';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, FormField, NotFound, Skeleton, inputClass } from '@shop/ui';
import { paiseToRupees, rupeesToPaise } from '../lib/list-params';

type Kind = Promotion['kind'];

/** All promotions with their schedule and rules of engagement; pause, edit or delete each one. */
export function PromotionsPage() {
  const api = useService(AdminPromotionApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.list(), [api]);
  const [confirming, setConfirming] = useState('');
  useEffect(() => {
    seo.set({ title: 'Promotions', noindex: true });
  }, [seo]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'That did not work. Please try again.');
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-muted">
          Automatic offers are applied by the cart. When offers conflict, the best allowed outcome wins; an <strong>exclusive</strong> offer never combines with another offer or a coupon. Test a change in the Simulator before it goes live.
        </p>
        <ButtonLink to="/promotions/list/new">New promotion</ButtonLink>
      </div>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No promotions" description="Create one to apply savings automatically." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[56rem] text-start text-sm">
              <caption className="sr-only">Promotions</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Name</th>
                  <th scope="col" className="p-2 text-start">Type</th>
                  <th scope="col" className="p-2 text-start">Runs</th>
                  <th scope="col" className="p-2 text-start">Who</th>
                  <th scope="col" className="p-2 text-start">Stacking</th>
                  <th scope="col" className="p-2 text-start">Status</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2">
                      <Link to={`/promotions/list/${p.id}`} className="font-medium text-primary hover:underline">
                        {p.name}
                      </Link>
                      <span className="block text-xs text-text-muted">Priority {p.priority}</span>
                    </td>
                    <td className="p-2">{PROMOTION_KIND_LABEL[p.kind]}</td>
                    <td className="whitespace-nowrap p-2 text-text-muted">
                      {p.startsAt ? date(p.startsAt, 'd MMM y') : 'Always'} to {p.endsAt ? date(p.endsAt, 'd MMM y') : 'no end'}
                    </td>
                    <td className="p-2">{SEGMENT_LABEL[p.segment]}</td>
                    <td className="p-2">{p.stacking === 'exclusive' ? 'Exclusive' : 'Stackable'}</td>
                    <td className="p-2">
                      <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? 'Active' : 'Paused'}</Badge>
                    </td>
                    <td className="whitespace-nowrap p-2 text-end">
                      <Button size="sm" variant="ghost" type="button" onClick={() => void run(() => firstValueFrom(api.setEnabled(p.id, !p.enabled)), p.enabled ? `${p.name} paused.` : `${p.name} is active again.`)}>
                        {p.enabled ? 'Pause' : 'Resume'}
                        <span className="sr-only"> {p.name}</span>
                      </Button>
                      {confirming === p.id ? (
                        <Button
                          size="sm"
                          variant="danger"
                          type="button"
                          onClick={() => {
                            setConfirming('');
                            void run(() => firstValueFrom(api.remove(p.id)), `${p.name} deleted.`);
                          }}
                        >
                          Confirm delete<span className="sr-only"> {p.name}</span>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" type="button" onClick={() => setConfirming(p.id)}>
                          Delete<span className="sr-only"> {p.name}</span>
                        </Button>
                      )}
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
        <Skeleton className="h-48" />
      )}
    </>
  );
}

/** ISO time to the value a datetime-local input wants (local time, minutes). */
const toLocalInput = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string): string | undefined => (value ? new Date(value).toISOString() : undefined);
const list = (text: string) => text.split(/[\s,]+/).filter(Boolean);
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

const KIND_OPTIONS = (Object.keys(PROMOTION_KIND_LABEL) as Kind[]).map((value) => ({ value, label: PROMOTION_KIND_LABEL[value] }));
const SEGMENT_OPTIONS = (Object.keys(SEGMENT_LABEL) as Segment[]).map((value) => ({ value, label: SEGMENT_LABEL[value] }));

interface FormState {
  kind: Kind;
  name: string;
  description: string;
  priority: string;
  segment: Segment;
  stacking: StackingMode;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  buy: string;
  get: string;
  percentOff: string;
  basis: 'subtotal' | 'quantity';
  tiersText: string;
  percent: string;
  categoryIds: string[];
  productIds: string;
  productId: string;
  dealPrice: string;
  cap: string;
  perOrderLimit: string;
}

const BLANK: FormState = {
  kind: 'category_sale', name: '', description: '', priority: '5', segment: 'all', stacking: 'stackable', enabled: true, startsAt: '', endsAt: '',
  buy: '2', get: '1', percentOff: '100', basis: 'subtotal', tiersText: '', percent: '10', categoryIds: [], productIds: '', productId: '', dealPrice: '', cap: '10', perOrderLimit: '',
};

const fromPromotion = (p: Promotion): FormState => {
  const s: FormState = { ...BLANK, kind: p.kind, name: p.name, description: p.description ?? '', priority: String(p.priority), segment: p.segment, stacking: p.stacking, enabled: p.enabled, startsAt: toLocalInput(p.startsAt), endsAt: toLocalInput(p.endsAt) };
  if (p.kind === 'buy_x_get_y') Object.assign(s, { buy: String(p.buy), get: String(p.get), percentOff: String(p.percentOff) });
  if (p.kind === 'tiered') Object.assign(s, { basis: p.basis, tiersText: p.tiers.map((t) => `${p.basis === 'subtotal' ? paiseToRupees(t.min) : t.min} ${t.percent}`).join('\n') });
  if (p.kind === 'category_sale') s.percent = String(p.percent);
  if (p.kind === 'flash') Object.assign(s, { productId: p.productId, dealPrice: paiseToRupees(p.dealPrice), cap: String(p.cap), perOrderLimit: p.perOrderLimit ? String(p.perOrderLimit) : '' });
  if (p.kind !== 'flash') Object.assign(s, { categoryIds: p.categoryIds ?? [], productIds: p.kind === 'category_sale' ? '' : (p.productIds ?? []).join('\n') });
  return s;
};

/** Create or edit one promotion. The form only collects values; the API validates and explains (field messages come back as-is). */
export function PromotionFormPage() {
  const { id } = useParams();
  const api = useService(AdminPromotionApi);
  const categoryApi = useService(CategoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const resource = useResource(() => api.list(), [api]);
  const categories = useResource(() => categoryApi.tree(), [categoryApi]).value ?? [];
  const [s, setS] = useState<FormState>(BLANK);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const existing = id && resource.value ? resource.value.find((p) => p.id === id) : undefined;
  const missing = !!id && !!resource.value && !existing;
  useEffect(() => {
    seo.set({ title: 'Promotion', noindex: true });
  }, [seo]);
  useEffect(() => {
    if (!resource.value) return;
    if (existing) setS(fromPromotion(existing));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.value, id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const text = (key: keyof FormState, label: string, extra: { hint?: string; required?: boolean; type?: string; inputMode?: 'numeric' | 'decimal'; errorKey?: string } = {}) => (
    <FormField label={label} hint={extra.hint} required={extra.required} error={errors[extra.errorKey ?? key] ?? ''}>
      {(f) => (
        <input id={f.id} className={inputClass} type={extra.type} inputMode={extra.inputMode} aria-describedby={f.describedBy} aria-invalid={errors[extra.errorKey ?? key] ? 'true' : undefined} value={s[key] as string} onChange={(e) => set(key, e.target.value as never)} />
      )}
    </FormField>
  );

  /** Builds the request from the form; numbers that don't parse become NaN so the API's own message explains them. */
  const build = (): PromotionInput => {
    const common = { name: s.name, description: s.description.trim() || undefined, enabled: s.enabled, priority: num(s.priority), segment: s.segment, stacking: s.stacking, startsAt: fromLocalInput(s.startsAt), endsAt: fromLocalInput(s.endsAt), ...(id ? { id } : {}) };
    const scope = { ...(s.categoryIds.length ? { categoryIds: s.categoryIds } : {}), ...(list(s.productIds).length ? { productIds: list(s.productIds) } : {}) };
    switch (s.kind) {
      case 'buy_x_get_y':
        return { ...common, ...scope, kind: 'buy_x_get_y', buy: num(s.buy), get: num(s.get), percentOff: num(s.percentOff) };
      case 'tiered': {
        const tiers = s.tiersText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [min, pct] = l.split(/[\s,]+/);
            return { min: s.basis === 'subtotal' ? (rupeesToPaise(min) ?? Number.NaN) : num(min), percent: num(pct ?? '') };
          });
        return { ...common, ...scope, kind: 'tiered', basis: s.basis, tiers };
      }
      case 'category_sale':
        return { ...common, kind: 'category_sale', categoryIds: s.categoryIds, percent: num(s.percent) };
      case 'flash':
        return { ...common, kind: 'flash', productId: s.productId.trim(), dealPrice: rupeesToPaise(s.dealPrice) ?? Number.NaN, cap: num(s.cap), ...(s.perOrderLimit.trim() ? { perOrderLimit: num(s.perOrderLimit) } : {}) };
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      await firstValueFrom(api.save(build()));
      toast.success('Promotion saved.');
      navigate('/promotions/list');
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? 'Please check the highlighted fields.' : err.message);
      } else setFormError('Could not save the promotion.');
    } finally {
      setSaving(false);
    }
  };

  if (missing) return <NotFound />;
  if (resource.status === 'error') return <ErrorState onRetry={resource.reload} />;
  if (!resource.value || !loaded) return <Skeleton className="h-96 max-w-2xl" />;

  return (
    <>
      <Link to="/promotions/list" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to promotions
      </Link>
      <h2 className="mb-4 text-xl font-bold">{id ? 'Edit promotion' : 'New promotion'}</h2>
      <form className="max-w-2xl space-y-4" onSubmit={save} noValidate>
        <FormField label="Type" required>
          {(f) => (
            <select id={f.id} className={inputClass} disabled={!!id} value={s.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {text('name', 'Name', { required: true })}
        {text('description', 'Description', { hint: 'Optional, shown to the team only' })}

        {s.kind === 'buy_x_get_y' && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {text('buy', 'Buy', { required: true, inputMode: 'numeric' })}
              {text('get', 'Get', { required: true, inputMode: 'numeric' })}
              {text('percentOff', 'Discount on those (%)', { required: true, inputMode: 'numeric', hint: '100 means free' })}
            </div>
            <p className="text-sm text-text-muted">The cheapest matching units in each group are the discounted ones.</p>
          </>
        )}
        {s.kind === 'tiered' && (
          <>
            <FormField label="Tiers are measured by">
              {(f) => (
                <select id={f.id} className={inputClass} value={s.basis} onChange={(e) => set('basis', e.target.value as 'subtotal' | 'quantity')}>
                  <option value="subtotal">Spend (₹)</option>
                  <option value="quantity">Number of items</option>
                </select>
              )}
            </FormField>
            <FormField label="Tiers" required hint={s.basis === 'subtotal' ? 'One tier per line: spend in ₹, then percent off. Example: 10000 5' : 'One tier per line: item count, then percent off. Example: 3 10'} error={errors['tiers'] ?? ''}>
              {(f) => <textarea id={f.id} className={inputClass} rows={3} aria-describedby={f.describedBy} aria-invalid={errors['tiers'] ? 'true' : undefined} value={s.tiersText} onChange={(e) => set('tiersText', e.target.value)} />}
            </FormField>
          </>
        )}
        {s.kind === 'category_sale' && text('percent', 'Percent off', { required: true, inputMode: 'numeric' })}
        {s.kind === 'flash' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {text('productId', 'Product id', { required: true, hint: 'e.g. p-0001' })}
              {text('dealPrice', 'Deal price (₹)', { required: true, inputMode: 'decimal' })}
              {text('cap', 'Units at the deal price', { required: true, inputMode: 'numeric' })}
              {text('perOrderLimit', 'Limit per order', { hint: 'Optional', inputMode: 'numeric' })}
            </div>
            <p className="text-sm text-text-muted">The deal ends at the end time or when the units run out, whichever comes first.</p>
          </>
        )}

        {s.kind !== 'flash' && (
          <>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">
                {s.kind === 'category_sale' ? 'Categories' : 'Limit to categories'}
                {s.kind === 'category_sale' && (
                  <span aria-hidden="true" className="text-danger">
                    {' '}
                    *
                  </span>
                )}
              </legend>
              <ul className="grid gap-1 sm:grid-cols-2">
                {categories.map((c) => (
                  <li key={c.id}>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-5 accent-primary" checked={s.categoryIds.includes(c.id)} onChange={(e) => set('categoryIds', e.target.checked ? [...new Set([...s.categoryIds, c.id])] : s.categoryIds.filter((x) => x !== c.id))} />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
              {errors['categoryIds'] && (
                <p className="text-sm text-danger" role="alert">
                  {errors['categoryIds']}
                </p>
              )}
            </fieldset>
            {s.kind !== 'category_sale' && (
              <FormField label="Limit to product ids" hint="Optional. One per line or comma separated. Leave both empty to cover everything.">
                {(f) => <textarea id={f.id} className={inputClass} rows={2} aria-describedby={f.describedBy} value={s.productIds} onChange={(e) => set('productIds', e.target.value)} />}
              </FormField>
            )}
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {text('startsAt', 'Starts', { type: 'datetime-local', hint: 'Leave empty to start now' })}
          {text('endsAt', 'Ends', { type: 'datetime-local', required: s.kind === 'flash', hint: s.kind === 'flash' ? 'Required: this drives the countdown' : 'Leave empty to run until paused' })}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Who gets it">
            {(f) => (
              <select id={f.id} className={inputClass} value={s.segment} onChange={(e) => set('segment', e.target.value as Segment)}>
                {SEGMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Stacking" hint="Exclusive offers never combine">
            {(f) => (
              <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={s.stacking} onChange={(e) => set('stacking', e.target.value as StackingMode)}>
                <option value="stackable">Stackable</option>
                <option value="exclusive">Exclusive</option>
              </select>
            )}
          </FormField>
          {text('priority', 'Priority', { hint: '0 to 100, higher first', inputMode: 'numeric' })}
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Active
        </label>

        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" loading={saving}>
          Save promotion
        </Button>
      </form>
    </>
  );
}
