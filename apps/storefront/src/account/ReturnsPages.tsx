import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ATTACHMENT_LIMITS, ApiException, RETURN_REASONS, attachmentProblem, reasonOf, type AttachmentMeta, type ReturnItemSelection, type ReturnStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { ReturnApi } from '@shop/data-access';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, FormField, NotFound, Skeleton, cx, inputClass, type BadgeTone } from '@shop/ui';

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  picked_up: 'Picked up',
  checked: 'Checked',
  refunded: 'Refunded',
  rejected: 'Not accepted',
};

export const returnTone = (status: ReturnStatus): BadgeTone => (status === 'refunded' ? 'success' : status === 'rejected' ? 'danger' : status === 'requested' ? 'neutral' : 'primary');

/** The customer's return requests, with their store credit balance. */
export function ReturnsListPage() {
  const api = useService(ReturnApi);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.list(), [api]);
  const credit = useResource(() => api.storeCredit(), [api]);
  useEffect(() => {
    seo.set({ title: 'Returns and refunds', noindex: true, path: '/account/returns' });
  }, [seo]);

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Returns and refunds</h1>
      <p className="mb-4 text-sm text-text-muted">
        To start a return, open a delivered order and choose “Return items”.{' '}
        {credit.value && credit.value.amount > 0 && <span className="ms-1 font-medium text-text">Store credit: {money(credit.value)}</span>}
      </p>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No returns yet" description="Returns you request will show up here with their progress.">
            <ButtonLink to="/orders">View my orders</ButtonLink>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {resource.value.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <Link to={`/account/returns/${r.id}`} className="font-medium hover:text-primary">
                    {r.id}
                  </Link>
                  <span className="block text-sm text-text-muted">
                    Order {r.orderId} · {r.items.length} {r.items.length === 1 ? 'item' : 'items'} · requested {date(r.createdAt, 'd MMM y')}
                  </span>
                </span>
                <span className="text-sm">{money(r.refund.total)}</span>
                <Badge tone={returnTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
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

/**
 * Chooses photos or documents to attach. Type, size and count are checked here for instant feedback and again by the API. Only
 * name, type and size travel in the mock; a real backend would upload the bytes after the same checks.
 */
export function AttachmentPicker({ label = 'Attach photos (optional)', onChange }: { label?: string; onChange: (files: AttachmentMeta[]) => void }) {
  const id = useId();
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [problem, setProblem] = useState('');
  const pick = (list: FileList | null) => {
    const chosen: AttachmentMeta[] = Array.from(list ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size }));
    const issue = attachmentProblem(chosen);
    setProblem(issue ?? '');
    setFiles(issue ? [] : chosen);
    onChange(issue ? [] : chosen);
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={id} type="file" multiple accept={ATTACHMENT_LIMITS.types.join(',')} className="block w-full text-sm" aria-describedby={`${id}-hint`} onChange={(e) => pick(e.target.files)} />
      <p id={`${id}-hint`} className="mt-1 text-sm text-text-muted">
        Up to {ATTACHMENT_LIMITS.maxCount} files, JPEG, PNG, WebP or PDF, {ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB each.
      </p>
      {problem && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {problem}
        </p>
      )}
      {files.length > 0 && (
        <ul className="mt-2 text-sm" aria-label="Chosen files">
          {files.map((f) => (
            <li key={f.name}>
              {f.name} <span className="text-text-muted">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MAX_COMMENTS = 500;

/** Return request for one delivered order: choose items, a reason, see the refund before sending. */
export function ReturnRequestPage() {
  const [params] = useSearchParams();
  const order = params.get('order') ?? undefined;
  const api = useService(ReturnApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const date = useDate();
  const money = useMoney();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const eligibility = useResource(() => api.eligibility(order!), [api, order], !!order);
  const e = eligibility.value;
  const notFound = eligibility.status === 'error' && eligibility.error instanceof ApiException && eligibility.error.code === 'not_found';

  const selections: ReturnItemSelection[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([variantId, quantity]) => ({ variantId, quantity }));
  // The refund is worked out by the API as soon as there is something to price.
  const quoteKey = JSON.stringify([order, selections, reason]);
  const quote = useResource(() => api.quote(order!, selections, reason), [api, quoteKey], !!order && selections.length > 0 && !!reason);
  const q = order && selections.length > 0 && reason ? quote.value : undefined;

  useEffect(() => {
    seo.set({ title: 'Return items', noindex: true, path: '/account/returns/new' });
  }, [seo]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErrors({});
    setFormError('');
    const local: Record<string, string> = {};
    if (selections.length === 0) local['items'] = 'Choose at least one item';
    if (!reason) local['reason'] = 'Choose a reason';
    if (comments.length > MAX_COMMENTS) local['comments'] = `Comments are limited to ${MAX_COMMENTS} characters`;
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      const created = await firstValueFrom(api.create({ orderId: order!, items: selections, reason, comments, attachments }));
      toast.success('Return requested. We will review it shortly.');
      navigate(`/account/returns/${created.id}`);
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? '' : err.message);
      } else setFormError('Could not send your request. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Return items</h1>
      {notFound ? (
        <NotFound />
      ) : e ? (
        <>
          <p className="mb-4 text-sm text-text-muted">
            Order {e.orderId}
            {e.windowEndsAt && <> · return by {date(e.windowEndsAt, 'd MMM y')}</>}
          </p>
          {!e.eligible ? (
            <div className="rounded-lg border border-border p-4" role="status">
              <p className="font-medium">This order can't be returned right now.</p>
              <p className="text-sm text-text-muted">{e.reason}</p>
              <p className="mt-3 text-sm">
                Something wrong?{' '}
                <Link className="text-primary underline" to={`/account/support/new?order=${e.orderId}`}>
                  Contact support
                </Link>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="max-w-2xl space-y-6">
              <fieldset>
                <legend className="mb-2 text-lg font-semibold">What are you returning?</legend>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {e.lines.map((line) => (
                    <li key={line.variantId} className="flex items-center gap-3 p-3">
                      <img src={line.image.url} width={56} height={56} alt="" className="size-14 shrink-0 rounded-md object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{line.title}</span>
                        <span className="block text-sm text-text-muted">
                          {money(line.unitPrice)} each · ordered {line.ordered}
                        </span>
                        {line.blockedReason && <span className="block text-sm text-text-muted">{line.blockedReason}</span>}
                      </span>
                      {line.returnable > 0 && (
                        <label className="text-sm">
                          <span className="sr-only">Quantity to return for {line.title}</span>
                          <select className={cx(inputClass, '!w-20')} value={quantities[line.variantId] ?? 0} onChange={(ev) => setQuantities((qs) => ({ ...qs, [line.variantId]: Number(ev.target.value) }))}>
                            {Array.from({ length: line.returnable + 1 }, (_, n) => n).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
                {errors['items'] && (
                  <p className="mt-1 text-sm text-danger" role="alert">
                    {errors['items']}
                  </p>
                )}
              </fieldset>

              <FormField label="Why are you returning it?" required error={errors['reason'] ?? ''}>
                {(f) => (
                  <select id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={errors['reason'] ? 'true' : undefined} value={reason} onChange={(ev) => setReason(ev.target.value)}>
                    <option value="">Choose a reason</option>
                    {RETURN_REASONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>

              <FormField label="Anything else we should know?" hint={`${comments.length} / ${MAX_COMMENTS}`} error={errors['comments'] ?? ''}>
                {(f) => <textarea id={f.id} className={inputClass} rows={3} aria-describedby={f.describedBy} value={comments} onChange={(ev) => setComments(ev.target.value)} />}
              </FormField>

              <div>
                <AttachmentPicker onChange={setAttachments} />
                {errors['attachments'] && (
                  <p className="mt-1 text-sm text-danger" role="alert">
                    {errors['attachments']}
                  </p>
                )}
              </div>

              <section className="rounded-lg border border-border p-4" aria-labelledby="refund-h" aria-live="polite">
                <h2 id="refund-h" className="mb-2 font-semibold">
                  Your refund
                </h2>
                {q ? (
                  <>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt>Items</dt>
                        <dd>{money(q.items)}</dd>
                      </div>
                      {q.discountShare.amount > 0 && (
                        <div className="flex justify-between">
                          <dt>Coupon discount share</dt>
                          <dd>− {money(q.discountShare)}</dd>
                        </div>
                      )}
                      {q.shippingRefund.amount > 0 && (
                        <div className="flex justify-between">
                          <dt>Shipping</dt>
                          <dd>{money(q.shippingRefund)}</dd>
                        </div>
                      )}
                      {q.returnFee.amount > 0 && (
                        <div className="flex justify-between">
                          <dt>Return shipping fee</dt>
                          <dd>− {money(q.returnFee)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                        <dt>Refund</dt>
                        <dd>{money(q.total)}</dd>
                      </div>
                    </dl>
                    <ul className="mt-2 list-disc ps-5 text-sm text-text-muted">
                      {q.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </>
                ) : quote.loading && selections.length > 0 && reason ? (
                  <p className="text-sm text-text-muted">Working out your refund…</p>
                ) : (
                  <p className="text-sm text-text-muted">Choose the items and a reason to see how much you will get back.</p>
                )}
              </section>

              {formError && (
                <p className="text-sm text-danger" role="alert">
                  {formError}
                </p>
              )}
              <Button type="submit" loading={saving}>
                Request return
              </Button>
            </form>
          )}
        </>
      ) : eligibility.status === 'error' ? (
        <ErrorState onRetry={eligibility.reload} />
      ) : (
        <Skeleton className="h-64 max-w-2xl" />
      )}
    </>
  );
}

const STEPS = ['requested', 'approved', 'picked_up', 'checked', 'refunded'] as const;
const STEP_LABEL = { requested: 'Return requested', approved: 'Approved', picked_up: 'Picked up', checked: 'Quality check passed', refunded: 'Refund issued' } as const;

/** One return with its refund timeline, which matches what staff see. */
export function ReturnDetailPage() {
  const { id = '' } = useParams();
  const api = useService(ReturnApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const resource = useResource(() => api.get(id), [api, id]);
  const [cancelling, setCancelling] = useState(false);
  const r = resource.value;
  const notFound = resource.status === 'error' && resource.error instanceof ApiException && resource.error.code === 'not_found';

  useEffect(() => {
    seo.set({ title: 'Return details', noindex: true, path: '/account/returns' });
  }, [seo]);

  const withdraw = async (returnId: string) => {
    setCancelling(true);
    try {
      await firstValueFrom(api.cancel(returnId));
      toast.info('Your return request was withdrawn.');
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not withdraw this request.');
    } finally {
      setCancelling(false);
    }
  };

  if (notFound) return <NotFound />;
  if (!r) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-64" />;

  const steps = STEPS.map((status) => ({ status, label: STEP_LABEL[status], at: r.timeline.find((t) => t.status === status)?.at }));
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Return {r.id}</h1>
      <p className="mb-4 text-sm text-text-muted">
        For order{' '}
        <Link to={`/orders/${r.orderId}`} className="text-primary underline">
          {r.orderId}
        </Link>{' '}
        · <Badge tone={returnTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section aria-labelledby="progress">
            <h2 id="progress" className="mb-3 text-lg font-semibold">
              Progress
            </h2>
            <ol className="space-y-3 border-s-2 border-border ps-4">
              {steps.map((step) => (
                <li key={step.status} className="relative">
                  <span className={cx('absolute -start-[1.4rem] top-1 size-3 rounded-full', step.at ? 'bg-success' : 'bg-border-strong')} aria-hidden="true" />
                  <p className={step.at ? 'font-medium' : 'text-text-muted'}>{step.label}</p>
                  <p className="text-sm text-text-muted">{step.at ? date(step.at, 'd MMM, h:mm a') : 'Pending'}</p>
                </li>
              ))}
            </ol>
            {r.status === 'rejected' && (
              <p className="mt-3 rounded-lg border border-danger p-3 text-sm" role="status">
                <strong>Not accepted.</strong> {r.rejectionReason}
              </p>
            )}
            {r.pickup && r.status === 'approved' && (
              <p className="mt-3 rounded-lg border border-border p-3 text-sm" role="status">
                A courier will collect the items on <strong>{date(r.pickup.date, 'd MMM y')}</strong>.
                {r.pickup.note && <span className="block text-text-muted">Note: {r.pickup.note}</span>}
              </p>
            )}
          </section>

          <section aria-labelledby="items">
            <h2 id="items" className="mb-3 text-lg font-semibold">
              Items
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {r.items.map((i) => (
                <li key={i.variantId} className="flex items-center gap-3 p-3">
                  <img src={i.image.url} width={56} height={56} alt="" className="size-14 rounded-md object-cover" />
                  <span className="min-w-0 flex-1">
                    <Link to={`/p/${i.slug}`} className="block truncate font-medium hover:text-primary">
                      {i.title}
                    </Link>
                    <span className="text-sm text-text-muted">
                      Quantity {i.quantity} · {money(i.unitPrice)} each
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-text-muted">
              Reason: {reasonOf(r.reason)?.label ?? r.reason}
              {r.comments && <> · “{r.comments}”</>}
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border p-4" aria-labelledby="refund">
            <h2 id="refund" className="mb-2 font-semibold">
              Refund
            </h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>Items</dt>
                <dd>{money(r.refund.items)}</dd>
              </div>
              {r.refund.discountShare.amount > 0 && (
                <div className="flex justify-between">
                  <dt>Coupon discount share</dt>
                  <dd>− {money(r.refund.discountShare)}</dd>
                </div>
              )}
              {r.refund.shippingRefund.amount > 0 && (
                <div className="flex justify-between">
                  <dt>Shipping</dt>
                  <dd>{money(r.refund.shippingRefund)}</dd>
                </div>
              )}
              {r.refund.returnFee.amount > 0 && (
                <div className="flex justify-between">
                  <dt>Return shipping fee</dt>
                  <dd>− {money(r.refund.returnFee)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>{money(r.refund.total)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-sm text-text-muted">
              {r.refund.method === 'original' ? 'To your original payment method' : 'As store credit'}
              {r.refundedAt && <> · paid {date(r.refundedAt, 'd MMM y')}</>}
            </p>
          </section>
          <div className="flex flex-wrap gap-2">
            {r.status === 'requested' && (
              <Button variant="ghost" type="button" loading={cancelling} onClick={() => void withdraw(r.id)}>
                Withdraw request
              </Button>
            )}
            <ButtonLink variant="secondary" to={`/account/support/new?order=${r.orderId}`}>
              Get help
            </ButtonLink>
          </div>
        </aside>
      </div>
    </>
  );
}
