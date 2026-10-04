import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiException, type LinkGroup, type ManagedPage, type NavLink, type PageStatus, type Redirect } from '@ecom/contracts';
import { SeoService, ToastService, renderContent, useDate, useResource, useService } from '@shop/core';
import { AdminContentApi } from '@shop/data-access';
import { Badge, Button, EmptyState, FormField, Skeleton, TextField, inputClass, rules, useForm } from '@shop/ui';

const BLANK_PAGE = { title: '', slug: '', source: '', seoTitle: '', seoDescription: '' };

export function PagesPage() {
  const api = useService(AdminContentApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.pages(), [api]);
  const [override, setOverride] = useState<ManagedPage[] | null>(null);
  const pages = override ?? resource.value ?? [];
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const [status, setStatus] = useState<PageStatus>('draft');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const form = useForm(BLANK_PAGE, { title: rules.required(), slug: rules.required() });
  useEffect(() => {
    seo.set({ title: 'Pages', noindex: true });
  }, [seo]);

  /** Same converter the API uses on save, so the preview matches what is published. */
  const preview = useMemo(() => DOMPurify.sanitize(renderContent(form.values.source)), [form.values.source]);

  const startNew = () => {
    form.reset(BLANK_PAGE);
    setStatus('draft');
    setIsNew(true);
    setFormError('');
    setEditing(true);
  };
  const edit = (p: ManagedPage) => {
    form.reset({ title: p.title, slug: p.slug, source: p.source, seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '' });
    setStatus(p.status);
    setIsNew(false);
    setFormError('');
    setEditing(true);
  };

  const apply = async <T,>(request: Observable<T>, message: string): Promise<T | undefined> => {
    try {
      const result = await firstValueFrom(request);
      toast.success(message);
      return result;
    } catch (e) {
      if (e instanceof ApiException) {
        if (editing) {
          setFormError(e.message);
          form.setServerErrors(e.fields ?? {});
        } else {
          toast.error(e.message);
        }
      } else {
        toast.error('The action failed.');
      }
      return undefined;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    form.validate();
    const f = form.values;
    setBusy(true);
    const saved = await apply(api.savePage({ slug: f.slug, title: f.title, source: f.source, status, seoTitle: f.seoTitle, seoDescription: f.seoDescription }, isNew), 'Page saved');
    setBusy(false);
    if (saved) {
      setEditing(false);
      setOverride(await firstValueFrom(api.pages()));
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Pages</h2>
        {!editing && (
          <Button type="button" onClick={startNew}>
            New page
          </Button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} noValidate className="mb-6 space-y-4 rounded-lg border border-border p-4" aria-label="Page editor">
          {formError && (
            <p className="rounded-md border border-danger p-3 text-sm" role="alert">
              {formError}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <TextField form={form} name="title" label="Title" required />
            <TextField form={form} name="slug" label="Address (slug)" required disabled={!isNew} hint={isNew ? 'Becomes /pages/your-slug' : 'The address cannot be changed'} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField form={form} name="source" label="Text" rows={12} hint="## Heading, - list item, **bold**, [link text](/path). Blank line starts a new paragraph." />
            <div>
              <p className="mb-1 text-sm font-medium" id="preview-h">
                Preview
              </p>
              <div
                className="min-h-40 space-y-3 rounded-md border border-border bg-surface-alt p-3 text-sm [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:ps-5 [&_a]:text-primary [&_a]:underline"
                aria-labelledby="preview-h"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField form={form} name="seoTitle" label="Search result title (optional)" maxLength={70} />
            <TextField form={form} name="seoDescription" label="Search result description (optional)" maxLength={160} hint="Up to 160 characters" />
          </div>
          <div className="max-w-xs">
            <FormField label="Status">
              {(f) => (
                <select id={f.id} className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as PageStatus)}>
                  <option value="draft">Draft (hidden from shoppers)</option>
                  <option value="published">Published</option>
                </select>
              )}
            </FormField>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              Save page
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {pages.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-start text-sm">
            <caption className="sr-only">Pages</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">Page</th>
                <th scope="col" className="p-2 text-start">Address</th>
                <th scope="col" className="p-2 text-start">Status</th>
                <th scope="col" className="p-2 text-start">Updated</th>
                <th scope="col" className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pages.map((p) => (
                <tr key={p.slug}>
                  <th scope="row" className="p-2 text-start font-medium">
                    {p.title}
                    {p.locked && <span className="ms-1 text-xs text-text-muted">(legal)</span>}
                  </th>
                  <td className="p-2 font-mono text-xs">/pages/{p.slug}</td>
                  <td className="p-2">
                    <Badge tone={p.status === 'published' ? 'success' : 'warning'}>{p.status}</Badge>
                  </td>
                  <td className="p-2 text-text-muted">{date(p.updatedAt, 'd MMM y')}</td>
                  <td className="p-2 text-end">
                    <button type="button" className="min-h-11 px-2 font-medium text-primary hover:underline" onClick={() => edit(p)}>
                      Edit<span className="sr-only"> {p.title}</span>
                    </button>
                    {!p.locked && (
                      <button
                        type="button"
                        className="min-h-11 px-2 font-medium text-danger hover:underline"
                        onClick={async () => {
                          const list = await apply(api.deletePage(p.slug), 'Page deleted');
                          if (list) setOverride(list);
                        }}
                      >
                        Delete<span className="sr-only"> {p.title}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : resource.loading ? (
        <Skeleton className="h-24" />
      ) : (
        <EmptyState title="No pages" description="Create your first page." />
      )}
    </>
  );
}

type Row = Omit<NavLink, 'id' | 'order'>;
const GROUPS: { key: LinkGroup; title: string }[] = [
  { key: 'about', title: 'Company links' },
  { key: 'help', title: 'Help links' },
  { key: 'legal', title: 'Legal links' },
];
const linkInput = 'block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-sm';
const square = 'min-h-11 min-w-11 rounded-md border border-border-strong text-sm';

export function LinksPage() {
  const api = useService(AdminContentApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const resource = useResource(() => api.links(), [api]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    seo.set({ title: 'Footer links', noindex: true });
  }, [seo]);
  useEffect(() => {
    if (!resource.value) return;
    setRows(resource.value.map(({ label, href, group }) => ({ label, href, group })));
    setLoaded(true);
  }, [resource.value]);

  const patch = (index: number, changes: Partial<Row>) => setRows((r) => r.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  /** Swaps with the neighbouring link of the same group. */
  const move = (index: number, delta: number) =>
    setRows((r) => {
      const group = r[index].group;
      let j = index + delta;
      while (j >= 0 && j < r.length && r[j].group !== group) j += delta;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const save = async () => {
    setFormError('');
    setErrors({});
    setBusy(true);
    try {
      const saved = await firstValueFrom(api.saveLinks(rows));
      setRows(saved.map(({ label, href, group }) => ({ label, href, group })));
      toast.success('Footer links saved');
    } catch (e) {
      if (e instanceof ApiException) {
        setFormError(e.message);
        setErrors(e.fields ?? {});
      } else {
        toast.error('Could not save.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">Footer links</h2>
      <p className="mb-4 text-sm text-text-muted">Links shown in the shop footer. Use an internal path such as /pages/faq or an https:// address.</p>
      {loaded ? (
        <>
          {formError && (
            <p className="mb-3 rounded-md border border-danger p-3 text-sm" role="alert">
              {formError}
            </p>
          )}
          <div className="grid gap-6 md:grid-cols-3">
            {GROUPS.map((g) => (
              <section key={g.key} aria-labelledby={`g-${g.key}`}>
                <h3 id={`g-${g.key}`} className="mb-2 font-semibold">
                  {g.title}
                </h3>
                <ul className="space-y-3">
                  {rows.map(
                    (row, i) =>
                      row.group === g.key && (
                        <li key={i} className="space-y-1 rounded-lg border border-border p-2">
                          <label className="sr-only" htmlFor={`l-${i}`}>
                            Label
                          </label>
                          <input id={`l-${i}`} className={linkInput} placeholder="Label" value={row.label} onChange={(e) => patch(i, { label: e.target.value })} maxLength={40} />
                          <label className="sr-only" htmlFor={`h-${i}`}>
                            Address
                          </label>
                          <input id={`h-${i}`} className={linkInput} placeholder="/pages/example" value={row.href} onChange={(e) => patch(i, { href: e.target.value })} />
                          {(errors[`links.${i}.label`] || errors[`links.${i}.href`]) && (
                            <p className="text-sm text-danger" role="alert">
                              {errors[`links.${i}.label`] || errors[`links.${i}.href`]}
                            </p>
                          )}
                          <div className="flex gap-1">
                            <button type="button" className={square} onClick={() => move(i, -1)} aria-label={`Move ${row.label || 'link'} up`}>
                              ↑
                            </button>
                            <button type="button" className={square} onClick={() => move(i, 1)} aria-label={`Move ${row.label || 'link'} down`}>
                              ↓
                            </button>
                            <button type="button" className="min-h-11 px-2 text-sm font-medium text-danger hover:underline" onClick={() => setRows((r) => r.filter((_, k) => k !== i))}>
                              Remove<span className="sr-only"> {row.label}</span>
                            </button>
                          </div>
                        </li>
                      ),
                  )}
                </ul>
                <Button size="sm" variant="secondary" type="button" className="mt-2" onClick={() => setRows((r) => [...r, { label: '', href: '/', group: g.key }])}>
                  Add link
                </Button>
              </section>
            ))}
          </div>
          <Button type="button" className="mt-6" loading={busy} onClick={() => void save()}>
            Save links
          </Button>
        </>
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}

export function RedirectsPage() {
  const api = useService(AdminContentApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.redirects(), [api]);
  const [override, setOverride] = useState<Redirect[] | null>(null);
  const redirects = override ?? resource.value ?? [];
  const [busy, setBusy] = useState(false);
  const form = useForm({ from: '', to: '' }, { from: rules.required(), to: rules.required() });
  useEffect(() => {
    seo.set({ title: 'Redirects', noindex: true });
  }, [seo]);

  const apply = async (request: Observable<Redirect[]>, message: string): Promise<boolean> => {
    try {
      setOverride(await firstValueFrom(request));
      toast.success(message);
      return true;
    } catch (e) {
      if (e instanceof ApiException) {
        form.setServerErrors(e.fields ?? {});
        toast.error(e.message);
      } else {
        toast.error('The action failed.');
      }
      return false;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.validate()) return;
    setBusy(true);
    const ok = await apply(api.addRedirect(form.values.from, form.values.to), 'Redirect added');
    setBusy(false);
    if (ok) form.reset();
  };

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">Redirects</h2>
      <p className="mb-4 text-sm text-text-muted">Send an old address to a new one with a permanent (301) redirect. Chains are followed and loops are refused.</p>
      <form onSubmit={add} noValidate className="mb-6 grid items-start gap-3 md:grid-cols-[1fr_1fr_auto]" aria-label="Add a redirect">
        <TextField form={form} name="from" label="From (old path)" placeholder="/old-page" />
        <TextField form={form} name="to" label="To (new path or https address)" placeholder="/new-page" />
        <Button type="submit" className="md:mt-6" loading={busy}>
          Add redirect
        </Button>
      </form>

      {redirects.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-start text-sm">
            <caption className="sr-only">Redirects</caption>
            <thead className="bg-surface-alt">
              <tr>
                <th scope="col" className="p-2 text-start">From</th>
                <th scope="col" className="p-2 text-start">To</th>
                <th scope="col" className="p-2 text-start">Created</th>
                <th scope="col" className="p-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {redirects.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="p-2 text-start font-mono text-xs">
                    {r.from}
                  </th>
                  <td className="p-2 font-mono text-xs">{r.to}</td>
                  <td className="p-2 text-text-muted">{date(r.createdAt, 'd MMM y')}</td>
                  <td className="p-2 text-end">
                    <button type="button" className="min-h-11 px-2 font-medium text-danger hover:underline" onClick={() => void apply(api.removeRedirect(r.id), 'Redirect removed')}>
                      Remove<span className="sr-only"> redirect from {r.from}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : resource.loading ? (
        <Skeleton className="h-16" />
      ) : (
        <EmptyState title="No redirects yet" description="Add one above when a page moves." />
      )}
    </>
  );
}
