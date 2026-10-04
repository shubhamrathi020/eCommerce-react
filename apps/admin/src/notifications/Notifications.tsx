import { useEffect, useState } from 'react';
import { firstValueFrom } from 'rxjs';
import { ApiException, type DeliveryStatus, type MessageTemplate } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminNotificationApi } from '@shop/data-access';
import { Badge, Button, EmptyState, ErrorState, FormField, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

/** Fills `{{variables}}` with sample text, the same as the admin "send test" preview. */
const preview = (text: string, vars: readonly string[]): string => vars.reduce((t, v) => t.replaceAll(`{{${v}}}`, `[${v}]`), text);

/** Message templates: list, an editor with a live preview, version history and "send a test". */
export function TemplatesPage() {
  const api = useService(AdminNotificationApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.templates(), [api]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected: MessageTemplate | undefined = resource.value?.find((t) => t.key === selectedKey);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    seo.set({ title: 'Notification templates', noindex: true });
  }, [seo]);

  const select = (t: MessageTemplate) => {
    setSelectedKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
    setTouched(false);
    setFormError('');
    setServerErrors({});
  };
  // Select the first template once the list loads, so the editor is never empty.
  useEffect(() => {
    const first = resource.value?.[0];
    if (first && !selectedKey) select(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.value]);

  const err = (name: 'subject' | 'body') => serverErrors[name] || (touched && !(name === 'subject' ? subject : body).trim() ? 'This field is required' : '');

  const save = async (key: string, e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setServerErrors({});
    setTouched(true);
    if (!subject.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await firstValueFrom(api.saveTemplate(key, { subject, body }));
      toast.success('Template saved');
      resource.reload();
    } catch (error) {
      if (error instanceof ApiException) {
        setFormError(error.message);
        setServerErrors(error.fields ?? {});
      } else setFormError('Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  const restore = async (key: string, version: number) => {
    try {
      const restored = await firstValueFrom(api.restoreVersion(key, version));
      toast.success(`Restored version ${version}`);
      resource.reload();
      select(restored);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not restore that version.');
    }
  };

  const sendTest = async (key: string) => {
    setTesting(true);
    try {
      await firstValueFrom(api.sendTest(key));
      toast.success('Test message sent to your mailbox');
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not send the test.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">
        Edit the wording customers receive. Use only the listed variables, written as <code>{'{{name}}'}</code>; anything else is refused. Every save keeps the previous version so you can go back.
      </p>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {resource.value ? (
          <ul className="space-y-1" aria-label="Templates">
            {resource.value.map((t) => (
              <li key={t.key}>
                <button type="button" className={cx('block min-h-11 w-full rounded-md px-3 py-2 text-start text-sm', selectedKey === t.key ? 'bg-primary text-primary-contrast' : 'hover:bg-surface-alt')} onClick={() => select(t)}>
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs opacity-80">
                    v{t.version} · {date(t.updatedAt, 'd MMM y')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton className="h-48" />
        )}

        {selected && (
          <section aria-labelledby="ed-h">
            <h2 id="ed-h" className="mb-1 text-lg font-semibold">
              {selected.name}
            </h2>
            <p className="mb-3 text-sm text-text-muted">
              {selected.description} Variables:{' '}
              {selected.variables.map((v, i) => (
                <span key={v}>
                  <code>{`{{${v}}}`}</code>
                  {i === selected.variables.length - 1 ? '' : ', '}
                </span>
              ))}
            </p>
            {formError && (
              <p className="mb-3 rounded-md border border-danger p-3 text-sm" role="alert">
                {formError}
              </p>
            )}
            <form onSubmit={(e) => void save(selected.key, e)} noValidate className="mb-6 grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <FormField label="Subject" error={err('subject')}>
                  {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={err('subject') ? 'true' : undefined} value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => setTouched(true)} />}
                </FormField>
                <FormField label="Message" error={err('body')}>
                  {(f) => <textarea id={f.id} className={inputClass} rows={6} aria-describedby={f.describedBy} aria-invalid={err('body') ? 'true' : undefined} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => setTouched(true)} />}
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={saving}>
                    Save (new version)
                  </Button>
                  <Button variant="secondary" type="button" loading={testing} onClick={() => void sendTest(selected.key)}>
                    Send test to my mailbox
                  </Button>
                </div>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium" id="prev-h">
                  Preview with sample data
                </p>
                <div className="rounded-md border border-border bg-surface-alt p-3 text-sm" aria-labelledby="prev-h">
                  <p className="mb-2 font-semibold">{preview(subject, selected.variables)}</p>
                  <p className="whitespace-pre-wrap">{preview(body, selected.variables)}</p>
                </div>
              </div>
            </form>

            <h3 className="mb-2 font-semibold">Previous versions</h3>
            {selected.history.length > 1 ? (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {selected.history.map((h) => (
                  <li key={h.version} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      Version {h.version} · {date(h.updatedAt, 'd MMM y, h:mm a')} · {h.updatedBy} {h.version === selected.version && <Badge tone="success">Current</Badge>}
                    </span>
                    {h.version !== selected.version && (
                      <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => void restore(selected.key, h.version)}>
                        Restore this version
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">No earlier versions yet.</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}

const PAGE_SIZE = 25;

/** Every message the platform has sent, with a reason and a retry for failures. */
export function DeliveryLogPage() {
  const api = useService(AdminNotificationApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const list = useListParams();
  const q = list.str('q');
  const status = list.str('status') as DeliveryStatus | undefined;
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Delivery log', noindex: true });
  }, [seo]);
  const resource = useResource(() => api.deliveryLog({ q, status, page: pageNo, pageSize: PAGE_SIZE }), [api, q, status, pageNo]);
  const data = resource.value;

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await firstValueFrom(api.retry(id));
      toast.success('Message resent');
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not retry that message.');
    } finally {
      setRetrying(null);
    }
  };

  return (
    <>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter the delivery log"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="dq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="dq" className={inputClass} type="search" placeholder="Recipient, subject or template" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ds" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select id="ds" className={inputClass} value={status ?? ''} onChange={(e) => list.patch({ status: e.target.value || null })}>
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="Nothing sent yet" description="Order, review and alert emails will show up here." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[46rem] text-start text-sm">
                <caption className="sr-only">Delivery log</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="p-2 text-start">When</th>
                    <th scope="col" className="p-2 text-start">To</th>
                    <th scope="col" className="p-2 text-start">Subject</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                    <th scope="col" className="p-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap p-2 text-text-muted">{date(e.at, 'd MMM y, h:mm a')}</td>
                      <td className="p-2">{e.to}</td>
                      <td className="p-2">
                        <span className="block max-w-xs truncate" title={e.subject}>
                          {e.subject}
                        </span>
                        {e.reason && <span className="block text-xs text-danger">{e.reason}</span>}
                        {e.attempts > 1 && <span className="block text-xs text-text-muted">{e.attempts} attempts</span>}
                      </td>
                      <td className="p-2">
                        <Badge tone={e.status === 'sent' ? 'success' : 'danger'}>{e.status}</Badge>
                      </td>
                      <td className="p-2 text-end">
                        {e.status === 'failed' && (
                          <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" disabled={retrying === e.id} onClick={() => void retry(e.id)}>
                            {retrying === e.id ? 'Retrying…' : 'Retry'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {data.total} messages
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
