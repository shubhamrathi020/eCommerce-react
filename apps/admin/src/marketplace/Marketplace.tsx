import { useEffect, useMemo, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { ApiException, SELLER_PRODUCT_STATUS_LABEL, SELLER_STATUS_LABEL, type CommissionRule, type PayoutPreview, type PayoutStatement, type SellerProductStatus, type SellerStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminSellerApi, CategoryApi, type AdminSellerProduct, type SellerWithCounts } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, FormField, Skeleton, cx, inputClass } from '@shop/ui';

const sellerTone = (status: SellerStatus) => (status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'danger');

/** Seller applications (review the KYC details, approve or reject with a reason) and the sellers already trading. */
function Sellers({ applications }: { applications: boolean }) {
  const api = useService(AdminSellerApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.sellers(), [api]);
  const rows = (resource.value ?? []).filter((s) => (applications ? s.status === 'pending' || s.status === 'rejected' : s.status === 'approved' || s.status === 'suspended'));

  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [commission, setCommission] = useState('');
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  useEffect(() => {
    seo.set({ title: applications ? 'Seller applications' : 'Sellers', noindex: true });
  }, [seo, applications]);

  const run = async (s: SellerWithCounts, action: () => Promise<unknown>, done: string) => {
    setBusy(s.id);
    setActive(s.id);
    setError('');
    setFieldError('');
    try {
      await action();
      toast.success(done);
      setRejecting('');
      resource.reload();
    } catch (e) {
      if (e instanceof ApiException && e.fields?.['reason']) setFieldError(e.fields['reason']);
      else if (e instanceof ApiException && e.fields?.['percent']) setError(e.fields['percent']);
      else setError(e instanceof ApiException ? e.message : 'That did not work. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const saveCommission = (s: SellerWithCounts) => {
    // Only a box the person actually typed in changes anything; an emptied box means "use the rules".
    if (active !== s.id) return;
    const text = commission.trim();
    void run(s, () => firstValueFrom(api.setCommission(s.id, text === '' ? null : Number(text))), `Commission for ${s.displayName} saved.`);
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">
        {applications ? 'Check the details against the documents the seller sent, then approve or reject. A rejected applicant sees your reason and can apply again.' : 'Sellers with access to the portal. Suspending a seller takes their listings off sale at once.'}
      </p>
      {resource.value ? (
        rows.length === 0 ? (
          <EmptyState title={applications ? 'No applications waiting' : 'No sellers yet'} />
        ) : (
          <ul className="space-y-4">
            {rows.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    {s.displayName} <Badge tone={sellerTone(s.status)}>{SELLER_STATUS_LABEL[s.status]}</Badge>
                  </h2>
                  <span className="text-sm text-text-muted">Applied {date(s.appliedAt, 'd MMM y')}</span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="inline text-text-muted">Legal name: </dt>
                    <dd className="inline">{s.legalName}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text-muted">Phone: </dt>
                    <dd className="inline">{s.phone}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text-muted">GSTIN: </dt>
                    <dd className="inline font-mono">{s.gstin}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text-muted">PAN: </dt>
                    <dd className="inline font-mono">{s.pan}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline text-text-muted">Address: </dt>
                    <dd className="inline">
                      {s.address.line1}, {s.address.city}, {s.address.state} {s.address.pincode}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline text-text-muted">Bank: </dt>
                    <dd className="inline">
                      {s.bankHolder}, {s.bankIfsc}, account ending {s.bankAccountLast4}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline text-text-muted">Policies: </dt>
                    <dd className="inline">
                      Returns: {s.policies.returns} Shipping: {s.policies.shipping}
                    </dd>
                  </div>
                  {!applications && (
                    <>
                      <div>
                        <dt className="inline text-text-muted">Listings: </dt>
                        <dd className="inline">
                          {s.liveProducts} live, {s.pendingProducts} waiting
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-text-muted">Commission: </dt>
                        <dd className="inline">{s.commissionRate === undefined ? 'By the rules' : s.commissionRate + '% (override)'}</dd>
                      </div>
                    </>
                  )}
                  {s.rejectionReason && (
                    <div className="sm:col-span-2">
                      <dt className="inline text-text-muted">Rejection reason: </dt>
                      <dd className="inline">{s.rejectionReason}</dd>
                    </div>
                  )}
                </dl>

                {error && active === s.id && (
                  <p className="mt-2 text-sm text-danger" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {s.status === 'pending' && (
                    <>
                      <Button size="sm" type="button" loading={busy === s.id} onClick={() => void run(s, () => firstValueFrom(api.decideSeller(s.id, { approve: true })), `${s.displayName} approved.`)}>
                        Approve {s.displayName}
                      </Button>
                      {rejecting === s.id ? (
                        <>
                          <div className="min-w-64 flex-1">
                            <FormField label="Reason (the applicant will see it)" error={fieldError}>
                              {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={fieldError ? 'true' : undefined} value={reason} onChange={(e) => setReason(e.target.value)} />}
                            </FormField>
                          </div>
                          <Button size="sm" variant="danger" type="button" loading={busy === s.id} onClick={() => void run(s, () => firstValueFrom(api.decideSeller(s.id, { approve: false, reason })), `${s.displayName} rejected.`)}>
                            Confirm rejection of {s.displayName}
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting('')}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          type="button"
                          onClick={() => {
                            setRejecting(s.id);
                            setReason('');
                            setFieldError('');
                          }}
                        >
                          Reject {s.displayName}
                        </Button>
                      )}
                    </>
                  )}
                  {(s.status === 'approved' || s.status === 'suspended') && (
                    <>
                      <FormField label="Commission override (%)" hint="Empty = use the rules">
                        {(f) => (
                          <input
                            id={f.id}
                            className={cx(inputClass, '!w-32')}
                            inputMode="decimal"
                            aria-describedby={f.describedBy}
                            value={active === s.id ? commission : (s.commissionRate ?? '')}
                            onChange={(e) => {
                              setActive(s.id);
                              setCommission(e.target.value);
                            }}
                          />
                        )}
                      </FormField>
                      <Button size="sm" variant="secondary" type="button" onClick={() => saveCommission(s)}>
                        Save commission for {s.displayName}
                      </Button>
                      <Button
                        size="sm"
                        variant={s.status === 'approved' ? 'danger' : 'secondary'}
                        type="button"
                        onClick={() => void run(s, () => firstValueFrom(api.setStanding(s.id, s.status === 'approved' ? 'suspended' : 'approved')), s.status === 'approved' ? `${s.displayName} suspended.` : `${s.displayName} restored.`)}
                      >
                        {s.status === 'approved' ? 'Suspend' : 'Restore'} {s.displayName}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
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

export const ApplicationsPage = () => <Sellers applications />;
export const SellersPage = () => <Sellers applications={false} />;

const listingTone = (status: SellerProductStatus) => (status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : 'neutral');
const LISTING_STATUSES = Object.keys(SELLER_PRODUCT_STATUS_LABEL) as SellerProductStatus[];

/** Seller listings waiting for approval. Only approved listings from sellers in good standing appear in the shop. */
export function ListingsPage() {
  const api = useService(AdminSellerApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const [status, setStatus] = useState<SellerProductStatus>('pending');
  const resource = useResource(() => api.products(status), [api, status]);
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [active, setActive] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  useEffect(() => {
    seo.set({ title: 'Seller listings', noindex: true });
  }, [seo]);

  const run = async (p: AdminSellerProduct, action: () => Promise<unknown>, done: string) => {
    setBusy(p.id);
    setActive(p.id);
    setError('');
    setFieldError('');
    try {
      await action();
      toast.success(done);
      setRejecting('');
      resource.reload();
    } catch (e) {
      if (e instanceof ApiException && e.fields?.['reason']) setFieldError(e.fields['reason']);
      else setError(e instanceof ApiException ? e.message : 'That did not work. Please try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ls" className="mb-1 block text-sm font-medium">
            Show
          </label>
          <select id="ls" className={cx(inputClass, '!w-52')} value={status} onChange={(e) => setStatus(e.target.value as SellerProductStatus)}>
            {LISTING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SELLER_PRODUCT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="Nothing here" description="No listings with this status." />
        ) : (
          <ul className="space-y-3">
            {resource.value.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    {p.title} <Badge tone={listingTone(p.status)}>{SELLER_PRODUCT_STATUS_LABEL[p.status]}</Badge>
                  </h2>
                  <span className="text-sm text-text-muted">
                    {p.sellerName} · updated {date(p.updatedAt, 'd MMM y')}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  {money({ amount: p.price, currency: 'INR' })}
                  {p.mrp ? <span className="text-text-muted"> (MRP {money({ amount: p.mrp, currency: 'INR' })})</span> : null} · {p.stock} in stock · {p.brandName} · {p.categoryId}
                </p>
                <p className="mt-1 text-sm text-text-muted">{p.description}</p>
                {p.rejectionReason && <p className="mt-1 text-sm">Rejected: {p.rejectionReason}</p>}
                {error && active === p.id && (
                  <p className="mt-2 text-sm text-danger" role="alert">
                    {error}
                  </p>
                )}
                {p.status === 'pending' && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Button size="sm" type="button" loading={busy === p.id} onClick={() => void run(p, () => firstValueFrom(api.decideProduct(p.id, { approve: true })), `${p.title} is now live.`)}>
                      Approve {p.title}
                    </Button>
                    {rejecting === p.id ? (
                      <>
                        <div className="min-w-64 flex-1">
                          <FormField label="Reason (the seller will see it)" error={fieldError}>
                            {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={fieldError ? 'true' : undefined} value={reason} onChange={(e) => setReason(e.target.value)} />}
                          </FormField>
                        </div>
                        <Button size="sm" variant="danger" type="button" loading={busy === p.id} onClick={() => void run(p, () => firstValueFrom(api.decideProduct(p.id, { approve: false, reason })), `${p.title} rejected.`)}>
                          Confirm rejection of {p.title}
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting('')}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="danger" type="button" onClick={() => setRejecting(p.id)}>
                        Reject {p.title}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
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

/** Commission rules. The most specific one wins: a seller's own override, a rule for the seller, the category (leaf first), then the default. */
export function CommissionPage() {
  const api = useService(AdminSellerApi);
  const categoryApi = useService(CategoryApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const resource = useResource(() => api.rules(), [api]);
  const sellers = useResource(() => api.sellers(), [api]).value ?? [];
  const tree = useResource(() => categoryApi.tree(), [categoryApi]).value;

  /** Every category with its parents in the label, so a leaf can be told apart from its department. */
  const categories = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: { id: string; name: string; children: unknown[] }[], prefix: string) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${prefix}${n.name}` });
        walk(n.children as typeof nodes, `${prefix}${n.name} › `);
      }
    };
    walk((tree ?? []) as never, '');
    return out;
  }, [tree]);

  const [scope, setScope] = useState<CommissionRule['scope']>('category');
  const [categoryId, setCategoryId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [percent, setPercent] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Commission', noindex: true });
  }, [seo]);

  const describe = (r: CommissionRule): string => {
    if (r.scope === 'default') return 'Everything else (default)';
    if (r.scope === 'category') return `Category: ${categories.find((c) => c.id === r.categoryId)?.label ?? r.categoryId}`;
    return `Seller: ${sellers.find((s) => s.id === r.sellerId)?.displayName ?? r.sellerId}`;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      const existing = (resource.value ?? []).find((r) => r.scope === scope && (scope === 'default' || (scope === 'category' ? r.categoryId === categoryId : r.sellerId === sellerId)));
      await firstValueFrom(
        api.saveRule({
          ...(existing ? { id: existing.id } : {}),
          scope,
          ...(scope === 'category' ? { categoryId } : {}),
          ...(scope === 'seller' ? { sellerId } : {}),
          percent: percent.trim() === '' ? Number.NaN : Number(percent),
        }),
      );
      toast.success('Commission rule saved.');
      resource.reload();
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? '' : err.message);
      } else setFormError('Could not save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: CommissionRule) => {
    try {
      await firstValueFrom(api.removeRule(r.id));
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not remove the rule.');
    }
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">
        The percentage the marketplace keeps from each sale. A seller's own override (set under Sellers) beats everything. Otherwise the most specific rule here applies: seller, then category, then the default.
      </p>
      {resource.value ? (
        <>
          <div className="mb-6 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] text-start text-sm">
              <caption className="sr-only">Commission rules</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Applies to</th>
                  <th scope="col" className="p-2 text-end">Commission</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resource.value.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="p-2 text-start font-normal">
                      {describe(r)}
                    </th>
                    <td className="p-2 text-end">{r.percent}%</td>
                    <td className="p-2 text-end">
                      {r.scope !== 'default' && (
                        <Button size="sm" variant="ghost" type="button" onClick={() => void remove(r)}>
                          Remove<span className="sr-only"> the rule for {describe(r)}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form className="grid max-w-3xl gap-3 sm:grid-cols-4 sm:items-start" onSubmit={save} noValidate aria-label="Add or change a rule">
            <FormField label="Applies to" error={errors['scope'] ?? ''}>
              {(f) => (
                <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={scope} onChange={(e) => setScope(e.target.value as CommissionRule['scope'])}>
                  <option value="default">Everything (default)</option>
                  <option value="category">A category</option>
                  <option value="seller">One seller</option>
                </select>
              )}
            </FormField>
            {scope === 'category' && (
              <FormField label="Category" error={errors['categoryId'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={errors['categoryId'] ? 'true' : undefined} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Choose…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            {scope === 'seller' && (
              <FormField label="Seller" error={errors['sellerId'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={errors['sellerId'] ? 'true' : undefined} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                    <option value="">Choose…</option>
                    {sellers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            <FormField label="Percent (0 to 50)" error={errors['percent'] ?? ''}>
              {(f) => <input id={f.id} className={inputClass} inputMode="decimal" aria-describedby={f.describedBy} aria-invalid={errors['percent'] ? 'true' : undefined} value={percent} onChange={(e) => setPercent(e.target.value)} />}
            </FormField>
            <div className="sm:pt-6">
              <Button type="submit" loading={saving}>
                Save rule
              </Button>
            </div>
          </form>
          {formError && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {formError}
            </p>
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

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inr = (amount: number) => ({ amount, currency: 'INR' as const });

/** Payout statements: see what a seller is owed for a period, issue it, and record the transfer. No money moves in this demo. */
export function PayoutsPage() {
  const api = useService(AdminSellerApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const sellers = useResource(() => api.sellers(), [api]).value ?? [];
  const statements = useResource(() => api.statements(), [api]);
  const approved = sellers.filter((s) => s.status === 'approved' || s.status === 'suspended');

  const [sellerId, setSellerId] = useState('');
  const [from, setFrom] = useState(() => iso(Date.now() - 30 * 86_400_000));
  const [to, setTo] = useState(() => iso(Date.now()));
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState('');
  const [paidFor, setPaidFor] = useState('');
  const [payError, setPayError] = useState('');
  useEffect(() => {
    seo.set({ title: 'Payouts', noindex: true });
  }, [seo]);

  const fail = (e: unknown) => {
    if (e instanceof ApiException) {
      setErrors(e.fields ?? {});
      setFormError(e.fields ? '' : e.message);
    } else setFormError('That did not work. Please try again.');
  };

  const runPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    if (!sellerId) {
      setErrors({ sellerId: 'Choose a seller' });
      return;
    }
    setBusy(true);
    try {
      setPreview(await firstValueFrom(api.payoutPreview(sellerId, from, to)));
    } catch (err) {
      setPreview(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const issue = async (p: PayoutPreview) => {
    setBusy(true);
    try {
      const st = await firstValueFrom(api.issuePayout(p.sellerId, p.from, p.to));
      toast.success(`Statement ${st.id} issued.`);
      setPreview(null);
      statements.reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (st: PayoutStatement) => {
    setPayError('');
    const ref = paidFor === st.id ? reference : '';
    setPaidFor(st.id);
    try {
      await firstValueFrom(api.markPaid(st.id, ref));
      toast.success(`${st.id} marked as paid.`);
      setReference('');
      statements.reload();
    } catch (e) {
      setPayError(e instanceof ApiException ? (e.fields?.['reference'] ?? e.message) : 'That did not work.');
    }
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">A statement is built from the seller's delivered shipments in the period, less commission, minus any returns refunded in the period. Each shipment and return can be on one statement only.</p>
      <form className="mb-6 flex flex-wrap items-start gap-3" onSubmit={runPreview} noValidate aria-label="Build a statement">
        <FormField label="Seller" error={errors['sellerId'] ?? ''}>
          {(f) => (
            <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Choose…</option>
              {approved.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="From" error={errors['from'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} type="date" aria-describedby={f.describedBy} value={from} onChange={(e) => setFrom(e.target.value)} />}
        </FormField>
        <FormField label="To" error={errors['to'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} type="date" aria-describedby={f.describedBy} value={to} onChange={(e) => setTo(e.target.value)} />}
        </FormField>
        <div className="pt-6">
          <Button variant="secondary" type="submit" loading={busy}>
            Preview
          </Button>
        </div>
      </form>
      {formError && (
        <p className="mb-4 text-sm text-danger" role="alert">
          {formError}
        </p>
      )}

      {preview && (
        <section className="mb-8 max-w-3xl" aria-labelledby="pv">
          <h2 id="pv" className="mb-2 text-lg font-semibold">
            {preview.sellerName}: {preview.from} to {preview.to}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem] text-start text-sm">
              <caption className="sr-only">Statement preview</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Order</th>
                  <th scope="col" className="p-2 text-start">Date</th>
                  <th scope="col" className="p-2 text-end">Sales</th>
                  <th scope="col" className="p-2 text-end">Commission</th>
                  <th scope="col" className="p-2 text-end">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.lines.map((l) => (
                  <tr key={l.shipmentId}>
                    <th scope="row" className="p-2 text-start font-normal">
                      {l.orderId}
                      <span className="block text-xs text-text-muted">{l.percent}%</span>
                    </th>
                    <td className="p-2">{date(l.deliveredAt, 'd MMM y')}</td>
                    <td className="p-2 text-end">{money(inr(l.gross))}</td>
                    <td className="p-2 text-end">−{money(inr(l.commission))}</td>
                    <td className="p-2 text-end">{money(inr(l.net))}</td>
                  </tr>
                ))}
                {preview.adjustments.map((a) => (
                  <tr key={a.returnId}>
                    <th scope="row" className="p-2 text-start font-normal">
                      Return {a.returnId}
                      <span className="block text-xs text-text-muted">order {a.orderId}</span>
                    </th>
                    <td className="p-2">{date(a.refundedAt, 'd MMM y')}</td>
                    <td className="p-2 text-end">{money(inr(a.gross))}</td>
                    <td className="p-2 text-end">{money(inr(-a.commission))}</td>
                    <td className="p-2 text-end">{money(inr(a.net))}</td>
                  </tr>
                ))}
                {preview.lines.length === 0 && preview.adjustments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-text-muted">
                      Nothing to pay out in this period.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-surface-alt font-semibold">
                <tr>
                  <th scope="row" colSpan={2} className="p-2 text-start">
                    Total
                  </th>
                  <td className="p-2 text-end">{money(inr(preview.gross))}</td>
                  <td className="p-2 text-end">−{money(inr(preview.commission))}</td>
                  <td className="p-2 text-end">{money(inr(preview.net))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Button className="mt-3" type="button" loading={busy} disabled={preview.lines.length === 0 && preview.adjustments.length === 0} onClick={() => void issue(preview)}>
            Issue statement
          </Button>
        </section>
      )}

      <h2 className="mb-2 text-lg font-semibold">Statements</h2>
      {statements.value ? (
        statements.value.length === 0 ? (
          <EmptyState title="No statements yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[44rem] text-start text-sm">
              <caption className="sr-only">Issued payout statements</caption>
              <thead className="bg-surface-alt">
                <tr>
                  <th scope="col" className="p-2 text-start">Statement</th>
                  <th scope="col" className="p-2 text-start">Seller</th>
                  <th scope="col" className="p-2 text-start">Period</th>
                  <th scope="col" className="p-2 text-end">Net</th>
                  <th scope="col" className="p-2 text-start">Status</th>
                  <th scope="col" className="p-2">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {statements.value.map((st) => (
                  <tr key={st.id}>
                    <th scope="row" className="p-2 text-start font-mono text-xs font-normal">
                      {st.id}
                    </th>
                    <td className="p-2">{st.sellerName}</td>
                    <td className="whitespace-nowrap p-2 text-text-muted">
                      {st.from} to {st.to}
                    </td>
                    <td className="p-2 text-end">{money(inr(st.net))}</td>
                    <td className="p-2">
                      <Badge tone={st.status === 'paid' ? 'success' : 'warning'}>{st.status === 'paid' ? 'Paid' : 'Issued'}</Badge>
                      {st.reference && <span className="block text-xs text-text-muted">{st.reference}</span>}
                    </td>
                    <td className="p-2">
                      {st.status === 'issued' && (
                        <div className="flex items-end justify-end gap-2">
                          <FormField label="Transfer reference" error={paidFor === st.id ? payError : ''}>
                            {(f) => (
                              <input
                                id={f.id}
                                className={cx(inputClass, '!w-44')}
                                aria-describedby={f.describedBy}
                                value={paidFor === st.id ? reference : ''}
                                onChange={(e) => {
                                  setReference(e.target.value);
                                  setPaidFor(st.id);
                                }}
                              />
                            )}
                          </FormField>
                          <Button size="sm" type="button" onClick={() => void markPaid(st)}>
                            Mark {st.id} paid
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : statements.status === 'error' ? (
        <ErrorState onRetry={statements.reload} />
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}
