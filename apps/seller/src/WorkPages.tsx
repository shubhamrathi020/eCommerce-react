import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, SELLER_NEXT, SELLER_PRODUCT_STATUS_LABEL, SHIPMENT_LABEL, type CategoryNode, type SellerProduct, type SellerShipmentView } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { CategoryApi, SellerPortalApi } from '@shop/data-access';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, FormField, NotFound, Skeleton, cx, inputClass } from '@shop/ui';

const productTone = (status: SellerProduct['status']) => (status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : 'neutral');

/** The seller's listings with their approval state, stock, and the items the store has assigned to them. Only their own. */
export function ProductsPage() {
  const api = useService(SellerPortalApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const money = useMoney();
  const resource = useResource(() => api.products(), [api]);
  const assigned = useResource(() => api.assignedItems(), [api]).value;
  const [stock, setStock] = useState('');
  const [stockFor, setStockFor] = useState('');
  const [errorId, setErrorId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    seo.set({ title: 'Products', noindex: true });
  }, [seo]);

  const run = async (p: SellerProduct, action: () => Promise<unknown>, done: string) => {
    setErrorId('');
    try {
      await action();
      toast.success(done);
      resource.reload();
    } catch (e) {
      setErrorId(p.id);
      setError(e instanceof ApiException ? (e.fields?.['stock'] ?? e.message) : 'That did not work. Please try again.');
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Products</h1>
        <ButtonLink to="/products/new">New product</ButtonLink>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">New listings and changes to a listing's text are reviewed before shoppers can see them. Changing only the price, MRP or stock of a live listing takes effect at once.</p>
      {resource.value ? (
        <>
          {resource.value.length === 0 ? (
            <EmptyState title="No listings yet" description="Create a product and submit it for approval.">
              <ButtonLink to="/products/new">New product</ButtonLink>
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {resource.value.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      {p.title} <Badge tone={productTone(p.status)}>{SELLER_PRODUCT_STATUS_LABEL[p.status]}</Badge>
                    </h2>
                    <span className="text-sm">{money({ amount: p.price, currency: 'INR' })}</span>
                  </div>
                  {p.rejectionReason && (
                    <p className="mt-1 text-sm text-danger" role="status">
                      Not approved: {p.rejectionReason}
                    </p>
                  )}
                  {errorId === p.id && (
                    <p className="mt-1 text-sm text-danger" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <FormField label="Units in stock">
                      {(f) => (
                        <input
                          id={f.id}
                          className={cx(inputClass, '!w-28')}
                          inputMode="numeric"
                          aria-describedby={f.describedBy}
                          value={stockFor === p.id ? stock : String(p.stock)}
                          onChange={(e) => {
                            setStock(e.target.value);
                            setStockFor(p.id);
                          }}
                        />
                      )}
                    </FormField>
                    <Button size="sm" variant="secondary" type="button" onClick={() => stockFor === p.id && void run(p, () => firstValueFrom(api.setStock(p.id, Number(stock))), `Stock for ${p.title} saved.`)}>
                      Save stock<span className="sr-only"> for {p.title}</span>
                    </Button>
                    <ButtonLink size="sm" variant="secondary" to={`/products/${p.id}`}>
                      Edit<span className="sr-only"> {p.title}</span>
                    </ButtonLink>
                    {(p.status === 'draft' || p.status === 'rejected') && (
                      <>
                        <Button size="sm" type="button" onClick={() => void run(p, () => firstValueFrom(api.submitProduct(p.id)), `${p.title} sent for approval.`)}>
                          Submit {p.title} for approval
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => void run(p, () => firstValueFrom(api.deleteProduct(p.id)), `${p.title} deleted.`)}>
                          Delete<span className="sr-only"> {p.title}</span>
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {assigned && assigned.length > 0 && (
            <>
              <h2 className="mb-2 mt-8 text-lg font-semibold">Items the store assigned to you</h2>
              <p className="mb-2 text-sm text-text-muted">These catalog items ship from you. The store manages their price and stock.</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[30rem] text-start text-sm">
                  <caption className="sr-only">Assigned catalog items</caption>
                  <thead className="bg-surface-alt">
                    <tr>
                      <th scope="col" className="p-2 text-start">Item</th>
                      <th scope="col" className="p-2 text-end">Price</th>
                      <th scope="col" className="p-2 text-end">In stock</th>
                      <th scope="col" className="p-2 text-end">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {assigned.map((a) => (
                      <tr key={a.productId}>
                        <th scope="row" className="p-2 text-start font-normal">
                          {a.title}
                        </th>
                        <td className="p-2 text-end">{money(a.price)}</td>
                        <td className="p-2 text-end">{a.stock}</td>
                        <td className="p-2 text-end">{a.rating.count ? `${a.rating.average} (${a.rating.count})` : 'No reviews'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

const rupeesToPaise = (text: string): number => {
  const n = Number(text.replace(/,/g, ''));
  return text.trim() === '' || !Number.isFinite(n) ? Number.NaN : Math.round(n * 100);
};

/** Create or edit a listing. A new listing starts as a draft; submit it for approval from the product list. */
export function ProductFormPage() {
  const { id } = useParams();
  const api = useService(SellerPortalApi);
  const categoryApi = useService(CategoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const resource = useResource(() => api.products(), [api]);
  const tree = useResource(() => categoryApi.tree(), [categoryApi]).value;
  const [f, setF] = useState({ title: '', brand: '', categoryId: '', description: '', price: '', mrp: '', stock: '0' });
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof f, value: string) => setF((cur) => ({ ...cur, [key]: value }));

  const existing = id && resource.value ? resource.value.find((p) => p.id === id) : undefined;
  /** Someone else's id looks exactly like a missing one. */
  const missing = !!id && !!resource.value && !existing;
  useEffect(() => {
    seo.set({ title: 'Product', noindex: true });
  }, [seo]);
  useEffect(() => {
    if (!resource.value) return;
    if (existing) setF({ title: existing.title, brand: existing.brandName, categoryId: existing.categoryId, description: existing.description, price: String(existing.price / 100), mrp: existing.mrp ? String(existing.mrp / 100) : '', stock: String(existing.stock) });
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.value, id]);

  /** Leaf categories only, labelled with their department. */
  const categoryOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: CategoryNode[], prefix: string) => {
      for (const n of nodes) {
        if (n.children.length) walk(n.children, `${prefix}${n.name} › `);
        else if (prefix) out.push({ id: n.id, label: `${prefix}${n.name}` });
      }
    };
    walk(tree ?? [], '');
    return out;
  }, [tree]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      await firstValueFrom(
        api.saveProduct({
          ...(id ? { id } : {}),
          title: f.title,
          brandName: f.brand,
          categoryId: f.categoryId,
          description: f.description,
          price: rupeesToPaise(f.price),
          ...(f.mrp.trim() ? { mrp: rupeesToPaise(f.mrp) } : {}),
          stock: f.stock.trim() === '' ? Number.NaN : Number(f.stock),
        }),
      );
      toast.success('Product saved.');
      navigate('/products');
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? 'Please check the highlighted fields.' : err.message);
      } else setFormError('Could not save the product.');
    } finally {
      setSaving(false);
    }
  };

  const text = (key: keyof typeof f, label: string, extra: { hint?: string; inputMode?: 'numeric' | 'decimal'; errorKey?: string } = {}) => (
    <FormField label={label} required={key !== 'mrp'} hint={extra.hint} error={errors[extra.errorKey ?? key === 'brand' ? 'brandName' : (extra.errorKey ?? key)] ?? ''}>
      {(ids) => {
        const errorKey = key === 'brand' ? 'brandName' : key;
        return <input id={ids.id} className={inputClass} inputMode={extra.inputMode} aria-describedby={ids.describedBy} aria-invalid={errors[errorKey] ? 'true' : undefined} value={f[key]} onChange={(e) => set(key, e.target.value)} />;
      }}
    </FormField>
  );

  if (missing) return <NotFound />;
  if (resource.status === 'error') return <ErrorState onRetry={resource.reload} />;
  if (!resource.value || !loaded) return <Skeleton className="h-96 max-w-2xl" />;

  return (
    <>
      <Link to="/products" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to products
      </Link>
      <h1 className="mb-1 text-2xl font-bold">{id ? 'Edit product' : 'New product'}</h1>
      {existing?.status === 'approved' && (
        <p className="mb-4 max-w-2xl text-sm text-text-muted">This listing is live. Changing the title, brand, category or description sends it back for approval and takes it off sale until then. Price, MRP and stock changes apply at once.</p>
      )}
      <form className="max-w-2xl space-y-4" onSubmit={save} noValidate>
        {text('title', 'Title')}
        {text('brand', 'Brand')}
        <FormField label="Category" required error={errors['categoryId'] ?? ''}>
          {(ids) => (
            <select id={ids.id} className={inputClass} aria-describedby={ids.describedBy} aria-invalid={errors['categoryId'] ? 'true' : undefined} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose…</option>
              {categoryOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Description" required error={errors['description'] ?? ''}>
          {(ids) => <textarea id={ids.id} className={inputClass} rows={5} aria-describedby={ids.describedBy} aria-invalid={errors['description'] ? 'true' : undefined} value={f.description} onChange={(e) => set('description', e.target.value)} />}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          {text('price', 'Price (₹)', { inputMode: 'decimal' })}
          {text('mrp', 'MRP (₹)', { inputMode: 'decimal', hint: 'Optional. Shown struck through only if it is a believable earlier price.' })}
          {text('stock', 'Units in stock', { inputMode: 'numeric' })}
        </div>
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </form>
    </>
  );
}

const NEXT_ACTION: Record<string, string> = { packed: 'Mark as packed', shipped: 'Mark as shipped', delivered: 'Mark as delivered' };

/** The seller's shipments: the part of each order they send. Only the ship-to details needed to deliver are shown. */
export function OrdersPage() {
  const api = useService(SellerPortalApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.shipments(), [api]);
  const [tracking, setTracking] = useState('');
  const [trackingFor, setTrackingFor] = useState('');
  const [busy, setBusy] = useState('');
  const [errorId, setErrorId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    seo.set({ title: 'Orders', noindex: true });
  }, [seo]);

  const advance = async (s: SellerShipmentView, next: string) => {
    setBusy(s.id);
    setErrorId('');
    try {
      await firstValueFrom(api.advanceShipment(s.id, next === 'shipped' && trackingFor === s.id ? tracking : undefined));
      toast.success(`${s.id} is now ${next}.`);
      resource.reload();
    } catch (e) {
      setErrorId(s.id);
      setError(e instanceof ApiException ? (e.fields?.['trackingNumber'] ?? e.message) : 'That did not work. Please try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Orders to ship</h1>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">Each shipment is your part of a customer's order. Move it along as you pack, hand it to a courier (add the tracking number) and it is delivered.</p>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No shipments yet" description="Paid and cash-on-delivery orders containing your products appear here." />
        ) : (
          <ul className="space-y-4">
            {resource.value.map((s) => {
              const next = SELLER_NEXT[s.status];
              return (
                <li key={s.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      {s.id} <Badge tone={s.status === 'delivered' ? 'success' : 'primary'}>{SHIPMENT_LABEL[s.status]}</Badge>
                    </h2>
                    <span className="text-sm text-text-muted">Placed {date(s.placedAt, 'd MMM y, h:mm a')}</span>
                  </div>
                  <ul className="mt-2 text-sm" aria-label="Items in this shipment">
                    {s.items.map((i, k) => (
                      <li key={k}>
                        {i.quantity} × {i.title} <span className="text-text-muted">({money(i.unitPrice)} each)</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    <span className="text-text-muted">Ship to:</span> {s.shipTo.name}, {s.shipTo.phone}, {s.shipTo.line1}
                    {s.shipTo.line2 && <>, {s.shipTo.line2}</>}, {s.shipTo.city}, {s.shipTo.state} {s.shipTo.pincode}
                  </p>
                  {s.trackingNumber && (
                    <p className="text-sm">
                      <span className="text-text-muted">Tracking:</span> <span className="font-mono">{s.trackingNumber}</span>
                    </p>
                  )}
                  {errorId === s.id && (
                    <p className="mt-2 text-sm text-danger" role="alert">
                      {error}
                    </p>
                  )}
                  {next && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {next === 'shipped' && (
                        <FormField label="Courier tracking number">
                          {(f) => (
                            <input
                              id={f.id}
                              className={cx(inputClass, '!w-56')}
                              autoComplete="off"
                              aria-describedby={f.describedBy}
                              value={trackingFor === s.id ? tracking : ''}
                              onChange={(e) => {
                                setTracking(e.target.value);
                                setTrackingFor(s.id);
                              }}
                            />
                          )}
                        </FormField>
                      )}
                      <Button size="sm" type="button" loading={busy === s.id} onClick={() => void advance(s, next)}>
                        {NEXT_ACTION[next]}
                        <span className="sr-only"> for {s.id}</span>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}

const inr = (amount: number) => ({ amount, currency: 'INR' as const });

/** What the seller is owed: sales not yet on a statement, and every statement issued to them. */
export function PayoutsPage() {
  const api = useService(SellerPortalApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.payouts(), [api]);
  useEffect(() => {
    seo.set({ title: 'Payouts', noindex: true });
  }, [seo]);
  const data = resource.value;
  const tile = (label: string, value: string) => (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Payouts</h1>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">You are paid for delivered shipments, less the marketplace commission, minus any returned items that were refunded. Statements are issued by the marketplace team.</p>
      {data ? (
        <>
          <section className="mb-8 max-w-3xl" aria-labelledby="up-h">
            <h2 id="up-h" className="mb-2 text-lg font-semibold">
              Not yet on a statement
            </h2>
            <dl className="mb-2 grid grid-cols-3 gap-3 text-sm">
              {tile('Sales', money(inr(data.upcoming.gross)))}
              {tile('Commission', '−' + money(inr(data.upcoming.commission)))}
              {tile('You will receive', money(inr(data.upcoming.net)))}
            </dl>
            {data.upcoming.lines.length || data.upcoming.adjustments.length ? (
              <ul className="text-sm text-text-muted" aria-label="What this is made of">
                {data.upcoming.lines.map((l) => (
                  <li key={l.shipmentId}>
                    Order {l.orderId} delivered {date(l.deliveredAt, 'd MMM')}: {money(inr(l.gross))} less {l.percent}% commission
                  </li>
                ))}
                {data.upcoming.adjustments.map((a) => (
                  <li key={a.returnId}>
                    Return {a.returnId} refunded {date(a.refundedAt, 'd MMM')}: {money(inr(a.net))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">Nothing delivered yet.</p>
            )}
          </section>

          <h2 className="mb-2 text-lg font-semibold">Statements</h2>
          {data.statements.length === 0 ? (
            <p className="text-sm text-text-muted">No statements have been issued to you yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem] text-start text-sm">
                <caption className="sr-only">Your payout statements</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">Statement</th>
                    <th scope="col" className="p-2 text-start">Period</th>
                    <th scope="col" className="p-2 text-end">Sales</th>
                    <th scope="col" className="p-2 text-end">Commission</th>
                    <th scope="col" className="p-2 text-end">Net</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.statements.map((st) => (
                    <tr key={st.id}>
                      <th scope="row" className="p-2 text-start font-mono text-xs font-normal">
                        {st.id}
                      </th>
                      <td className="whitespace-nowrap p-2 text-text-muted">
                        {st.from} to {st.to}
                      </td>
                      <td className="p-2 text-end">{money(inr(st.gross))}</td>
                      <td className="p-2 text-end">−{money(inr(st.commission))}</td>
                      <td className="p-2 text-end font-medium">{money(inr(st.net))}</td>
                      <td className="p-2">
                        <Badge tone={st.status === 'paid' ? 'success' : 'warning'}>{st.status === 'paid' ? 'Paid' : 'Issued'}</Badge>
                        {st.reference && <span className="block text-xs text-text-muted">{st.reference}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : resource.status === 'error' ? (
        <ErrorState onRetry={resource.reload} />
      ) : (
        <Skeleton className="h-48" />
      )}
    </>
  );
}
