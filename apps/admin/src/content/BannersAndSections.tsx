import { useEffect, useState } from 'react';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiException, type ContentBanner, type HomeSection } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useResource, useService } from '@shop/core';
import { AdminContentApi } from '@shop/data-access';
import { Badge, Button, EmptyState, FormError, Skeleton, TextField, rules, useForm } from '@shop/ui';

/** `datetime-local` values are local time without a zone; convert to and from ISO. */
export const toLocalInput = (iso?: string): string => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
export const fromLocalInput = (value: string): string | undefined => (value ? new Date(value).toISOString() : undefined);

const SAMPLE_IMAGES = ['/mock/img/hero-1.svg', '/mock/img/hero-2.svg', '/mock/img/hero-3.svg', '/mock/img/hero-4.svg'];
const BLANK_BANNER = { title: '', subtitle: '', cta: 'Shop now', link: '/', imageUrl: SAMPLE_IMAGES[0], imageAlt: '', startsAt: '', endsAt: '' };

const arrow = 'min-h-11 min-w-11 rounded-md border border-border-strong hover:bg-surface-alt disabled:opacity-40';

export function BannersPage() {
  const api = useService(AdminContentApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const resource = useResource(() => api.banners(), [api]);
  const [override, setOverride] = useState<ContentBanner[] | null>(null);
  const banners = override ?? resource.value ?? [];
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const form = useForm(BLANK_BANNER, { title: rules.required(), cta: rules.required(), link: rules.required(), imageUrl: rules.required(), imageAlt: rules.required() });
  useEffect(() => {
    seo.set({ title: 'Banners', noindex: true });
  }, [seo]);

  const startNew = () => {
    setEditingId(undefined);
    setActive(true);
    form.reset(BLANK_BANNER);
    setFormError('');
    setEditing(true);
  };
  const edit = (b: ContentBanner) => {
    setEditingId(b.id);
    setActive(b.active);
    form.reset({ title: b.title, subtitle: b.subtitle, cta: b.cta, link: b.link, imageUrl: b.image.url, imageAlt: b.image.alt, startsAt: toLocalInput(b.startsAt), endsAt: toLocalInput(b.endsAt) });
    setFormError('');
    setEditing(true);
  };

  const apply = async (request: Observable<ContentBanner[]>, message: string): Promise<boolean> => {
    try {
      setOverride(await firstValueFrom(request));
      toast.success(message);
      return true;
    } catch (e) {
      if (e instanceof ApiException) {
        setFormError(editing ? e.message : '');
        form.setServerErrors(e.fields ?? {});
        if (!editing) toast.error(e.message);
      } else {
        toast.error('The action failed.');
      }
      return false;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    form.validate();
    const f = form.values;
    setBusy(true);
    const ok = await apply(
      api.saveBanner({
        ...(editingId ? { id: editingId } : {}),
        title: f.title,
        subtitle: f.subtitle,
        cta: f.cta,
        link: f.link.trim(),
        image: { url: f.imageUrl.trim(), alt: f.imageAlt, width: 1600, height: 560 },
        active,
        startsAt: fromLocalInput(f.startsAt),
        endsAt: fromLocalInput(f.endsAt),
      }),
      'Banner saved',
    );
    setBusy(false);
    if (ok) setEditing(false);
  };

  const move = (index: number, delta: number) => {
    const ids = banners.map((b) => b.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return apply(api.reorderBanners(ids), 'Order updated');
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Home banners</h2>
        {!editing && (
          <Button type="button" onClick={startNew}>
            New banner
          </Button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} noValidate className="mb-6 grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2" aria-label="Banner form">
          {formError && (
            <p className="rounded-md border border-danger p-3 text-sm md:col-span-2" role="alert">
              {formError}
            </p>
          )}
          <TextField form={form} name="title" label="Title" required maxLength={80} className="md:col-span-2" />
          <TextField form={form} name="subtitle" label="Subtitle" maxLength={160} className="md:col-span-2" />
          <TextField form={form} name="cta" label="Button text" required maxLength={30} />
          <TextField form={form} name="link" label="Link" required hint="For example /c/fashion or https://example.com" />
          <TextField form={form} name="imageUrl" label="Image" required hint="Pick a sample image or paste a path or https:// address" list="banner-images" />
          <datalist id="banner-images">
            {SAMPLE_IMAGES.map((img) => (
              <option key={img} value={img} />
            ))}
          </datalist>
          <TextField form={form} name="imageAlt" label="Image description (alt text)" required />
          <TextField form={form} name="startsAt" label="Show from (optional)" type="datetime-local" />
          <TextField form={form} name="endsAt" label="Show until (optional)" type="datetime-local" />
          <label className="flex min-h-11 items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (shown on the home page when in date)
          </label>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" loading={busy}>
              Save banner
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {banners.length ? (
        <ol className="space-y-3" aria-label="Banners in display order">
          {banners.map((b, i) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <img src={b.image.url} width={128} height={45} alt={b.image.alt} className="h-12 w-32 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.title}</p>
                <p className="text-xs text-text-muted">
                  {b.link} · {b.startsAt ? date(b.startsAt, 'd MMM y') : 'no start'} to {b.endsAt ? date(b.endsAt, 'd MMM y') : 'no end'}
                </p>
              </div>
              <Badge tone={b.active ? 'success' : 'neutral'}>{b.active ? 'Active' : 'Inactive'}</Badge>
              <div className="flex gap-1">
                <button type="button" className={arrow} disabled={i === 0} onClick={() => void move(i, -1)} aria-label={`Move ${b.title} up`}>
                  ↑
                </button>
                <button type="button" className={arrow} disabled={i === banners.length - 1} onClick={() => void move(i, 1)} aria-label={`Move ${b.title} down`}>
                  ↓
                </button>
                <button type="button" className="min-h-11 px-3 text-sm font-medium text-primary hover:underline" onClick={() => edit(b)}>
                  Edit<span className="sr-only"> {b.title}</span>
                </button>
                <button type="button" className="min-h-11 px-3 text-sm font-medium text-danger hover:underline" onClick={() => void apply(api.deleteBanner(b.id), 'Banner deleted')}>
                  Delete<span className="sr-only"> {b.title}</span>
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : resource.loading ? (
        <Skeleton className="h-24" />
      ) : (
        <EmptyState title="No banners" description="The home page will show no banner carousel." />
      )}
    </>
  );
}

const SECTION_DESCRIPTION: Record<string, string> = {
  categories: 'Tiles for each top-level category',
  deals: "Deals with today's countdown",
  featured: 'Popular in-stock products',
  new: 'Newest products',
  best: 'Best-rated products',
  brands: 'Brand links',
  recent: 'What this shopper viewed recently',
};

export function SectionsPage() {
  const api = useService(AdminContentApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const resource = useResource(() => api.sections(), [api]);
  const [draft, setDraft] = useState<HomeSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    seo.set({ title: 'Home sections', noindex: true });
  }, [seo]);
  useEffect(() => {
    if (resource.value) setDraft(resource.value);
  }, [resource.value]);

  const patch = (index: number, changes: Partial<HomeSection>) => setDraft((list) => list.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  const move = (index: number, delta: number) =>
    setDraft((list) => {
      const next = [...list];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });

  const save = async () => {
    setFormError('');
    setServerErrors({});
    setBusy(true);
    try {
      setDraft(await firstValueFrom(api.saveSections(draft)));
      toast.success('Home sections saved');
    } catch (e) {
      if (e instanceof ApiException) {
        setFormError(e.message);
        setServerErrors(e.fields ?? {});
      } else {
        toast.error('Could not save.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">Home sections</h2>
      <p className="mb-4 text-sm text-text-muted">Choose what appears on the home page and in which order. The banner carousel is managed under Banners.</p>
      {draft.length ? (
        <>
          <FormError>{formError}</FormError>
          <ol className="mb-4 space-y-2" aria-label="Sections in display order">
            {draft.map((s, i) => (
              <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" className="size-5 accent-primary" checked={s.enabled} onChange={() => patch(i, { enabled: !s.enabled })} />
                  <span className="sr-only">Show {s.title}</span>
                </label>
                <div className="min-w-0 flex-1">
                  <label htmlFor={`title-${s.key}`} className="sr-only">
                    Title for {s.key}
                  </label>
                  <input id={`title-${s.key}`} className="block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3" value={s.title} onChange={(e) => patch(i, { title: e.target.value })} maxLength={40} />
                  <p className="mt-1 text-xs text-text-muted">{SECTION_DESCRIPTION[s.key] ?? ''}</p>
                  {serverErrors[`sections.${i}.title`] && (
                    <p className="text-sm text-danger" role="alert">
                      {serverErrors[`sections.${i}.title`]}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button type="button" className={arrow} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.title} up`}>
                    ↑
                  </button>
                  <button type="button" className={arrow} disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.title} down`}>
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Button type="button" loading={busy} onClick={() => void save()}>
            Save sections
          </Button>
        </>
      ) : (
        <Skeleton className="h-32" />
      )}
    </>
  );
}
