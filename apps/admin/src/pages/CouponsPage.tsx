import { useEffect, useState } from 'react';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiException, type AdminCoupon, type CouponKind } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminCouponApi } from '@shop/data-access';
import { Badge, Button, ErrorState, FormField, Skeleton, TextField, inputClass, rules, useForm } from '@shop/ui';
import { paiseToRupees, rupeesToPaise } from '../lib/list-params';

const KIND_LABEL: Record<CouponKind, string> = { percent: 'Percent off', flat: 'Flat amount off', free_shipping: 'Free shipping' };
const KINDS = (Object.keys(KIND_LABEL) as CouponKind[]).map((value) => ({ value, label: KIND_LABEL[value] }));
const BLANK = { code: '', description: '', kind: 'percent' as string, value: '10', minSubtotal: '0', maxDiscount: '', expiresAt: '' };

export default function CouponsPage() {
  const api = useService(AdminCouponApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.list(), [api]);
  const [override, setOverride] = useState<AdminCoupon[] | null>(null);
  const coupons = override ?? resource.value ?? [];
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const form = useForm(BLANK, { code: rules.required(), description: rules.required() });
  const kind = form.values.kind as CouponKind;
  useEffect(() => {
    seo.set({ title: 'Coupons', noindex: true });
  }, [seo]);

  const describe = (c: AdminCoupon): string => {
    if (c.kind === 'free_shipping') return KIND_LABEL[c.kind];
    return c.kind === 'percent' ? `${c.value}% off${c.maxDiscount ? ` (up to ₹${c.maxDiscount / 100})` : ''}` : `₹${c.value / 100} off`;
  };

  const startNew = () => {
    form.reset(BLANK);
    setIsNew(true);
    setEditing(true);
  };
  const edit = (c: AdminCoupon) => {
    form.reset({ code: c.code, description: c.description, kind: c.kind, value: c.kind === 'percent' ? String(c.value) : paiseToRupees(c.value), minSubtotal: paiseToRupees(c.minSubtotal), maxDiscount: paiseToRupees(c.maxDiscount), expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '' });
    setIsNew(false);
    setEditing(true);
  };

  const apply = async (request: Observable<AdminCoupon[]>, message: string): Promise<boolean> => {
    try {
      setOverride(await firstValueFrom(request));
      toast.success(message);
      return true;
    } catch (e) {
      if (e instanceof ApiException && e.fields) form.setServerErrors(e.fields);
      else toast.error(e instanceof ApiException ? e.message : 'The action failed.');
      return false;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    form.validate();
    const f = form.values;
    const percent = f.kind === 'percent';
    const maxDiscount = rupeesToPaise(f.maxDiscount);
    const code = f.code.trim().toUpperCase();
    const coupon: Omit<AdminCoupon, 'usageCount'> = {
      code,
      description: f.description,
      kind,
      value: f.kind === 'free_shipping' ? 0 : percent ? Number(f.value) : (rupeesToPaise(f.value) ?? 0),
      minSubtotal: rupeesToPaise(f.minSubtotal) ?? 0,
      ...(percent && maxDiscount !== undefined ? { maxDiscount } : {}),
      ...(f.expiresAt ? { expiresAt: `${f.expiresAt}T23:59:59Z` } : {}),
      active: coupons.find((c) => c.code === code)?.active ?? true,
    };
    setBusy(true);
    const ok = await apply(api.save(coupon, isNew), isNew ? 'Coupon created' : 'Coupon saved');
    setBusy(false);
    if (ok) setEditing(false);
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Coupons</h1>
        {!editing && (
          <Button type="button" onClick={startNew}>
            New coupon
          </Button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} noValidate className="mb-6 grid gap-4 rounded-lg border border-border p-4 md:grid-cols-3" aria-label="Coupon form">
          <TextField form={form} name="code" label="Code" required maxLength={20} disabled={!isNew} style={{ textTransform: 'uppercase' }} />
          <TextField form={form} name="description" label="Description" required className="md:col-span-2" />
          <FormField label="Type">
            {(f) => (
              <select id={f.id} className={inputClass} value={form.values.kind} onChange={(e) => form.set('kind', e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {kind !== 'free_shipping' && <TextField form={form} name="value" label={kind === 'percent' ? 'Percent off' : 'Amount off (₹)'} inputMode="decimal" />}
          <TextField form={form} name="minSubtotal" label="Minimum order (₹)" inputMode="decimal" />
          {kind === 'percent' && <TextField form={form} name="maxDiscount" label="Maximum discount (₹, optional)" inputMode="decimal" />}
          <TextField form={form} name="expiresAt" label="Expires on (optional)" type="date" />
          <div className="flex gap-2 md:col-span-3">
            <Button type="submit" loading={busy}>
              Save coupon
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {coupons.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[42rem] text-start text-sm">
            <caption className="sr-only">Coupons</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">Code</th>
                <th scope="col" className="p-2 text-start">Offer</th>
                <th scope="col" className="p-2 text-end">Minimum</th>
                <th scope="col" className="p-2 text-start">Expires</th>
                <th scope="col" className="p-2 text-end">Used</th>
                <th scope="col" className="p-2 text-start">Status</th>
                <th scope="col" className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coupons.map((c) => (
                <tr key={c.code}>
                  <th scope="row" className="p-2 text-start font-mono font-semibold">
                    {c.code}
                  </th>
                  <td className="p-2">
                    {describe(c)}
                    <span className="block text-xs text-text-muted">{c.description}</span>
                  </td>
                  <td className="p-2 text-end">{money({ amount: c.minSubtotal, currency: 'INR' })}</td>
                  <td className="p-2">{c.expiresAt ? date(c.expiresAt, 'd MMM y') : 'Never'}</td>
                  <td className="p-2 text-end">{c.usageCount}</td>
                  <td className="p-2">
                    <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="p-2 text-end">
                    <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => edit(c)}>
                      Edit<span className="sr-only"> {c.code}</span>
                    </button>
                    <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => void apply(api.setActive(c.code, !c.active), `${c.code} ${c.active ? 'deactivated' : 'activated'}`)}>
                      {c.active ? 'Deactivate' : 'Activate'}
                      <span className="sr-only"> {c.code}</span>
                    </button>
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
