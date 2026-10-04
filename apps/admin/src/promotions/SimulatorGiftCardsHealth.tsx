import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { ApiException, formatMoney, type GiftCard, type SimulationResult } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminGiftCardApi, AdminPromotionApi, CatalogApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, FormField, Skeleton, inputClass } from '@shop/ui';
import { rupeesToPaise } from '../lib/list-params';

interface Row {
  key: number;
  variantId: string;
  quantity: string;
}

let nextKey = 0;

/** Promotion simulator: run a sample cart through the real engine and see which rules fire and why. Changes nothing. */
export function SimulatorPage() {
  const api = useService(AdminPromotionApi);
  const catalog = useService(CatalogApi);
  const seo = useService(SeoService);
  const money = useMoney();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [coupon, setCoupon] = useState('');
  const [prior, setPrior] = useState('0');
  const [at, setAt] = useState('');
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SimulationResult | null>(null);
  useEffect(() => {
    seo.set({ title: 'Promotion simulator', noindex: true });
  }, [seo]);

  /** One choice per variant of the products matching the search (first 30). */
  const q = search.trim();
  const options = useResource(
    () =>
      catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 30, ...(q ? { q } : {}) }).pipe(
        switchMap((l) => catalog.productsByIds(l.items.map((i) => i.id))),
        map((products) =>
          products.flatMap((p) =>
            p.variants.map((v) => {
              const opts = Object.values(v.options).join(' / ');
              return { variantId: v.id, label: `${p.title}${opts ? ` (${opts})` : ''} · ${formatMoney(v.price)}` };
            }),
          ),
        ),
      ),
    [catalog, q],
  );
  const choices = options.value ?? [];

  // Start with one row once the product list has loaded.
  useEffect(() => {
    if (choices.length > 0 && rows.length === 0) setRows([{ key: nextKey++, variantId: choices[0].variantId, quantity: '1' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices.length]);

  const patchRow = (key: number, changes: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...changes } : x)));

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setRunning(true);
    try {
      setResult(
        await firstValueFrom(
          api.simulate({
            items: rows.map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) || 0 })),
            ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
            priorOrders: Math.max(0, Number(prior) || 0),
            ...(at ? { at: new Date(at).toISOString() } : {}),
          }),
        ),
      );
    } catch (err) {
      setResult(null);
      setErrors(err instanceof ApiException ? (err.fields ?? { items: err.message }) : { items: 'The simulation failed. Please try again.' });
    } finally {
      setRunning(false);
    }
  };

  const r = result;
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">Build a sample cart and press Run. The result uses exactly the same rules a shopper's cart uses, at the time you choose. No stock, order or deal counter is touched.</p>
      {options.value || rows.length > 0 ? (
        <form className="max-w-3xl space-y-4" onSubmit={run} noValidate>
          <FormField label="Find products" hint="Type part of a product name to change the choices below">
            {(f) => <input id={f.id} className={inputClass} type="search" aria-describedby={f.describedBy} value={search} onChange={(e) => setSearch(e.target.value)} />}
          </FormField>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Sample cart</legend>
            {rows.map((row, i) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`sv${row.key}`} className="mb-1 block text-sm">
                    Item {i + 1}
                  </label>
                  <select id={`sv${row.key}`} className={inputClass} value={row.variantId} onChange={(e) => patchRow(row.key, { variantId: e.target.value })}>
                    {/* Keep the chosen variant selectable even after a search narrows the list. */}
                    {!choices.some((o) => o.variantId === row.variantId) && <option value={row.variantId}>{row.variantId}</option>}
                    {choices.map((o) => (
                      <option key={o.variantId} value={o.variantId}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label htmlFor={`sq${row.key}`} className="mb-1 block text-sm">
                    Quantity
                  </label>
                  <input id={`sq${row.key}`} className={inputClass} inputMode="numeric" value={row.quantity} onChange={(e) => patchRow(row.key, { quantity: e.target.value })} />
                </div>
                <Button variant="ghost" type="button" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== row.key))}>
                  Remove<span className="sr-only"> item {i + 1}</span>
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" type="button" onClick={() => setRows((rs) => [...rs, { key: nextKey++, variantId: choices[0]?.variantId ?? '', quantity: '1' }])}>
              Add another item
            </Button>
            {errors['items'] && (
              <p className="text-sm text-danger" role="alert">
                {errors['items']}
              </p>
            )}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Coupon code" hint="Optional, e.g. FLAT100">
              {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} value={coupon} onChange={(e) => setCoupon(e.target.value)} />}
            </FormField>
            <FormField label="Orders already placed" hint="0 = first order">
              {(f) => <input id={f.id} className={inputClass} inputMode="numeric" aria-describedby={f.describedBy} value={prior} onChange={(e) => setPrior(e.target.value)} />}
            </FormField>
            <FormField label="At" hint="Empty = now" error={errors['at'] ?? ''}>
              {(f) => <input id={f.id} className={inputClass} type="datetime-local" aria-describedby={f.describedBy} value={at} onChange={(e) => setAt(e.target.value)} />}
            </FormField>
          </div>
          <Button type="submit" loading={running}>
            Run simulation
          </Button>
        </form>
      ) : (
        <Skeleton className="h-48 max-w-3xl" />
      )}

      {r && (
        <section className="mt-8 max-w-3xl" aria-labelledby="sim-result" aria-live="polite">
          <h2 id="sim-result" className="mb-3 text-lg font-semibold">
            Result
          </h2>
          <dl className="mb-4 space-y-1 rounded-lg border border-border p-4 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{money(r.subtotal)}</dd>
            </div>
            {r.applied.map((a) => (
              <div key={a.promotionId} className="flex justify-between text-success">
                <dt>
                  {a.name} <span className="text-text-muted">({a.label})</span>
                </dt>
                <dd>−{money(a.amount)}</dd>
              </div>
            ))}
            {r.couponDiscount.amount > 0 && (
              <div className="flex justify-between text-success">
                <dt>Coupon</dt>
                <dd>−{money(r.couponDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd>{r.shipping.amount === 0 ? 'Free' : money(r.shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{money(r.total)}</dd>
            </div>
          </dl>
          {r.couponNote && <p className="mb-4 rounded-md border border-warning p-3 text-sm">{r.couponNote}</p>}
          <h3 className="mb-2 font-semibold">Why each rule did or did not apply</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-start text-sm">
              <caption className="sr-only">Rule by rule explanation</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Promotion</th>
                  <th scope="col" className="p-2 text-start">Outcome</th>
                  <th scope="col" className="p-2 text-start">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.trace.map((t) => (
                  <tr key={t.promotionId}>
                    <td className="p-2">{t.name}</td>
                    <td className="p-2">
                      <Badge tone={t.outcome === 'applied' ? 'success' : 'neutral'}>{t.outcome === 'applied' ? 'Applied' : 'Skipped'}</Badge>
                    </td>
                    <td className="p-2">
                      {t.reason}
                      {t.amount ? (
                        <span className="block text-xs text-text-muted">
                          {t.outcome === 'applied' ? 'Saves' : 'Would save'} {money({ amount: t.amount, currency: 'INR' })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Issue gift cards and see each balance with its full history. Balances never go below zero. */
export function GiftCardsPage() {
  const api = useService(AdminGiftCardApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.list(), [api]);
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [expires, setExpires] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState('');
  useEffect(() => {
    seo.set({ title: 'Gift cards', noindex: true });
  }, [seo]);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      const card = await firstValueFrom(api.issue({ amount: rupeesToPaise(amount) ?? Number.NaN, ...(code.trim() ? { code } : {}), ...(issuedTo.trim() ? { issuedTo } : {}), ...(expires ? { expiresOn: expires } : {}) }));
      toast.success(`Gift card ${card.code} issued.`);
      setAmount('');
      setCode('');
      setIssuedTo('');
      setExpires('');
      resource.reload();
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? '' : err.message);
      } else setFormError('Could not issue the gift card.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (g: GiftCard) => {
    try {
      await firstValueFrom(api.setStatus(g.code, g.status === 'active' ? 'disabled' : 'active'));
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'That did not work.');
    }
  };

  return (
    <>
      <form className="mb-6 grid max-w-3xl gap-3 sm:grid-cols-5 sm:items-start" onSubmit={issue} noValidate aria-label="Issue a gift card">
        <FormField label="Amount (₹)" required error={errors['amount'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} inputMode="decimal" aria-describedby={f.describedBy} aria-invalid={errors['amount'] ? 'true' : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </FormField>
        <FormField label="Code" hint="Empty = generate" error={errors['code'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={errors['code'] ? 'true' : undefined} value={code} onChange={(e) => setCode(e.target.value)} />}
        </FormField>
        <FormField label="Issued to" hint="Optional">
          {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} />}
        </FormField>
        <FormField label="Expires on" hint="Optional" error={errors['expiresOn'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} type="date" aria-describedby={f.describedBy} value={expires} onChange={(e) => setExpires(e.target.value)} />}
        </FormField>
        <div className="sm:pt-6">
          <Button type="submit" loading={saving}>
            Issue card
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
          <EmptyState title="No gift cards" description="Issue one above." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[44rem] text-start text-sm">
              <caption className="sr-only">Gift cards</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Code</th>
                  <th scope="col" className="p-2 text-end">Issued</th>
                  <th scope="col" className="p-2 text-end">Balance</th>
                  <th scope="col" className="p-2 text-start">Expires</th>
                  <th scope="col" className="p-2 text-start">Status</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((g) => (
                  <GiftCardRow key={g.code} g={g} open={open === g.code} onToggleHistory={() => setOpen(open === g.code ? '' : g.code)} onToggle={() => void toggle(g)} date={date} money={money} />
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

function GiftCardRow({ g, open, onToggleHistory, onToggle, date, money }: { g: GiftCard; open: boolean; onToggleHistory: () => void; onToggle: () => void; date: ReturnType<typeof useDate>; money: ReturnType<typeof useMoney> }) {
  return (
    <>
      <tr>
        <td className="p-2 font-mono">
          {g.code}
          {g.issuedTo && <span className="block font-sans text-xs text-text-muted">{g.issuedTo}</span>}
        </td>
        <td className="p-2 text-end">{money({ amount: g.initialAmount, currency: 'INR' })}</td>
        <td className="p-2 text-end font-medium">{money({ amount: g.balance, currency: 'INR' })}</td>
        <td className="whitespace-nowrap p-2 text-text-muted">{g.expiresAt ? date(g.expiresAt, 'd MMM y') : 'Never'}</td>
        <td className="p-2">
          <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status === 'active' ? 'Active' : 'Disabled'}</Badge>
        </td>
        <td className="whitespace-nowrap p-2 text-end">
          <Button size="sm" variant="ghost" type="button" aria-expanded={open} onClick={onToggleHistory}>
            History<span className="sr-only"> for {g.code}</span>
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onToggle}>
            {g.status === 'active' ? 'Disable' : 'Enable'}
            <span className="sr-only"> {g.code}</span>
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-surface-alt p-3">
            <ul className="space-y-1 text-sm" aria-label={`History of ${g.code}`}>
              {g.entries.map((en) => (
                <li key={en.id}>
                  {date(en.at, 'd MMM y, h:mm a')} · <strong>{en.type}</strong> {money({ amount: en.amount, currency: 'INR' })}
                  {en.orderId && <> · order {en.orderId}</>} · {en.actor}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/** Variants whose "was" price would make a misleading discount label. The shop hides the label for these. */
export function PriceHealthPage() {
  const api = useService(AdminPromotionApi);
  const seo = useService(SeoService);
  const money = useMoney();
  const resource = useResource(() => api.priceHealth(), [api]);
  useEffect(() => {
    seo.set({ title: 'Price health', noindex: true });
  }, [seo]);
  const header = useMemo(() => 'A struck-through MRP and a “% off” label are shown only when the MRP is a believable earlier price: above the selling price and no more than four times it (75% off). Anything else is listed here and shown to shoppers without a discount label until you correct it.', []);
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">{header}</p>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No misleading discounts" description="Every MRP in the catalog is a believable earlier price." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <caption className="sr-only">Variants with a questionable MRP</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Product</th>
                  <th scope="col" className="p-2 text-start">SKU</th>
                  <th scope="col" className="p-2 text-end">Price</th>
                  <th scope="col" className="p-2 text-end">MRP</th>
                  <th scope="col" className="p-2 text-start">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((i) => (
                  <tr key={i.variantId}>
                    <td className="p-2">
                      <Link to={`/products/${i.productId}`} className="text-primary hover:underline">
                        {i.title}
                      </Link>
                    </td>
                    <td className="p-2 font-mono text-xs">{i.sku}</td>
                    <td className="p-2 text-end">{money(i.price)}</td>
                    <td className="p-2 text-end">{money(i.mrp)}</td>
                    <td className="p-2">{i.problem}</td>
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
