import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, TICKET_LIMITS, TICKET_STATUS_LABEL, type AttachmentMeta, type TicketStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { OrderApi, SupportApi } from '@shop/data-access';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, FormField, NotFound, Skeleton, cx, inputClass } from '@shop/ui';
import { AttachmentPicker } from './ReturnsPages';

const tone = (s: TicketStatus) => (s === 'closed' ? 'neutral' : s === 'pending' ? 'warning' : 'primary');

/** The customer's support tickets. They only ever see their own. */
export function SupportListPage() {
  const api = useService(SupportApi);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.list(), [api]);
  useEffect(() => {
    seo.set({ title: 'Help and support', noindex: true, path: '/account/support' });
  }, [seo]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">Help and support</h1>
        <ButtonLink to="/account/support/new">Ask a question</ButtonLink>
      </div>
      {resource.value ? (
        resource.value.length === 0 ? (
          <EmptyState title="No questions yet" description="Ask us about an order and our team will reply here.">
            <ButtonLink to="/account/support/new">Ask a question</ButtonLink>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {resource.value.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <Link to={`/account/support/${t.id}`} className="font-medium hover:text-primary">
                    {t.subject}
                  </Link>
                  <span className="block text-sm text-text-muted">
                    {t.id}
                    {t.orderId && <> · Order {t.orderId}</>} · updated {date(t.updatedAt, 'd MMM, h:mm a')}
                  </span>
                </span>
                <Badge tone={tone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>
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

/** New question, optionally about one of the customer's orders. */
export function SupportNewPage() {
  const [params] = useSearchParams();
  const api = useService(SupportApi);
  const orderApi = useService(OrderApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const orders = useResource(() => orderApi.list(), [orderApi]);
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Ask a question', noindex: true, path: '/account/support/new' });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const local: Record<string, string> = {};
    if (!subject.trim()) local['subject'] = 'Add a short subject';
    if (!message.trim()) local['message'] = 'Write your message';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      const ticket = await firstValueFrom(api.create({ subject, message, ...(orderId ? { orderId } : {}), attachments }));
      toast.success('Thanks, we have your question.');
      navigate(`/account/support/${ticket.id}`);
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? '' : err.message);
      } else setFormError('Could not send your question. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Ask a question</h1>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-4">
        <FormField label="About which order?" hint="Optional" error={errors['orderId'] ?? ''}>
          {(f) => (
            <select id={f.id} className={inputClass} aria-describedby={f.describedBy} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Not about a specific order</option>
              {(orders.value ?? []).map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Subject" required error={errors['subject'] ?? ''}>
          {(f) => <input id={f.id} className={inputClass} maxLength={TICKET_LIMITS.subject} aria-describedby={f.describedBy} aria-invalid={errors['subject'] ? 'true' : undefined} value={subject} onChange={(e) => setSubject(e.target.value)} />}
        </FormField>
        <FormField label="Your message" required hint={`${message.length} / ${TICKET_LIMITS.message}`} error={errors['message'] ?? ''}>
          {(f) => <textarea id={f.id} className={inputClass} rows={5} aria-describedby={f.describedBy} aria-invalid={errors['message'] ? 'true' : undefined} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </FormField>
        <div>
          <AttachmentPicker onChange={setAttachments} />
          {errors['attachments'] && (
            <p className="mt-1 text-sm text-danger" role="alert">
              {errors['attachments']}
            </p>
          )}
        </div>
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" loading={saving}>
          Send
        </Button>
      </form>
    </>
  );
}

/** One conversation: timestamped messages, a reply box, and a close button. */
export function SupportDetailPage() {
  const { id = '' } = useParams();
  const api = useService(SupportApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.get(id), [api, id]);
  const [reply, setReply] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const t = resource.value;
  const notFound = resource.status === 'error' && resource.error instanceof ApiException && resource.error.code === 'not_found';
  useEffect(() => {
    seo.set({ title: 'Support question', noindex: true, path: '/account/support' });
  }, [seo]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!reply.trim()) {
      setError('Write a message first');
      return;
    }
    setSaving(true);
    try {
      await firstValueFrom(api.reply(id, { message: reply, attachments }));
      setReply('');
      resource.reload();
    } catch (err) {
      setError(err instanceof ApiException ? (err.fields?.['message'] ?? err.fields?.['attachments'] ?? err.message) : 'Could not send your reply.');
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    try {
      await firstValueFrom(api.close(id));
      toast.info('Question closed.');
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not close this question.');
    }
  };

  if (notFound) return <NotFound />;
  if (!t) return resource.status === 'error' ? <ErrorState onRetry={resource.reload} /> : <Skeleton className="h-64 max-w-2xl" />;
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">{t.subject}</h1>
      <p className="mb-4 text-sm text-text-muted">
        {t.id}
        {t.orderId && (
          <>
            {' '}
            · Order{' '}
            <Link to={`/orders/${t.orderId}`} className="text-primary underline">
              {t.orderId}
            </Link>
          </>
        )}{' '}
        · <Badge tone={tone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>
      </p>

      <ol className="mb-6 max-w-2xl space-y-3" aria-label="Messages">
        {t.messages.map((m) => (
          <li key={m.id} className={cx('rounded-lg border p-3', m.author === 'staff' ? 'border-primary' : 'border-border')}>
            <p className="mb-1 flex justify-between text-sm">
              <strong>{m.author === 'staff' ? `${m.authorName} (support)` : 'You'}</strong>
              <time dateTime={m.at} className="text-text-muted">
                {date(m.at, 'd MMM y, h:mm a')}
              </time>
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
            {m.attachments.length > 0 && <p className="mt-1 text-sm text-text-muted">Attached: {m.attachments.map((f) => f.name).join(', ')}</p>}
          </li>
        ))}
      </ol>

      {t.status === 'closed' ? (
        <p className="text-sm text-text-muted" role="status">
          This question is closed.{' '}
          <Link to="/account/support/new" className="text-primary underline">
            Ask a new one
          </Link>{' '}
          if you still need help.
        </p>
      ) : (
        <form onSubmit={send} noValidate className="max-w-2xl space-y-4">
          <FormField label="Reply" error={error}>
            {(f) => <textarea id={f.id} className={inputClass} rows={4} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} value={reply} onChange={(e) => setReply(e.target.value)} />}
          </FormField>
          <AttachmentPicker onChange={setAttachments} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>
              Send reply
            </Button>
            <Button variant="ghost" type="button" onClick={() => void close()}>
              Close this question
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
