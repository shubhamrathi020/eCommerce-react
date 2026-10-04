import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, type AdminProductInput, type AdminVariantInput, type ProductStatus } from '@ecom/contracts';
import { SeoService, ToastService, useResource, useService } from '@shop/core';
import { AdminProductApi } from '@shop/data-access';
import { Button, ButtonLink, ErrorState, FormField, NotFound, Skeleton, inputClass } from '@shop/ui';
import { paiseToRupees, rupeesToPaise } from '../lib/list-params';

const STATUSES: ProductStatus[] = ['draft', 'published', 'archived'];

function parseOptions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const [k, ...rest] = part.split('=');
    if (k?.trim() && rest.join('=').trim()) out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

const formatOptions = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

interface VariantDraft {
  /** Stable key for the list; not sent to the API. */
  key: number;
  id: string;
  sku: string;
  options: string;
  price: string;
  mrp: string;
  stock: string;
}

let nextKey = 0;
const blankVariant = (): VariantDraft => ({ key: nextKey++, id: '', sku: '', options: '', price: '', mrp: '', stock: '0' });

interface Draft {
  title: string;
  brandName: string;
  categoryId: string;
  status: ProductStatus;
  tags: string;
  description: string;
  highlights: string;
  variants: VariantDraft[];
}

const BLANK: Draft = { title: '', brandName: '', categoryId: '', status: 'draft', tags: '', description: '', highlights: '', variants: [] };

/** Create or edit a product, including its variants. Money is typed in rupees; the API works in paise. */
export default function ProductFormPage() {
  const { id } = useParams();
  const api = useService(AdminProductApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();

  const categories = useResource(() => api.categories(), [api]);
  const detail = useResource(() => api.get(id!), [api, id], !!id);
  const [form, setForm] = useState<Draft>({ ...BLANK, variants: [blankVariant()] });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    seo.set({ title: 'Product', noindex: true });
  }, [seo]);

  // Editing: start from the saved product.
  useEffect(() => {
    const d = detail.value;
    if (!d) return;
    setForm({
      title: d.title,
      brandName: d.brandName,
      categoryId: d.categoryId,
      status: d.status,
      tags: d.tags.join(', '),
      description: d.description,
      highlights: d.highlights.join('\n'),
      variants: d.variants.map((v) => ({ key: nextKey++, id: v.id ?? '', sku: v.sku, options: formatOptions(v.options), price: paiseToRupees(v.price), mrp: paiseToRupees(v.mrp), stock: String(v.stock) })),
    });
  }, [detail.value]);

  const missing = detail.status === 'error' && detail.error instanceof ApiException && detail.error.code === 'not_found';
  const loadError = detail.status === 'error' && !missing;
  const ready = !!categories.value && (!id || !!detail.value);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setVariant = (key: number, patch: Partial<VariantDraft>) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));

  const blank = (v: string) => touched && !v.trim();
  const err = (name: 'title' | 'brandName' | 'categoryId' | 'description'): string => serverErrors[name] || (name !== 'description' && blank(form[name]) ? 'This field is required' : '');
  const verr = (index: number, name: 'sku' | 'price' | 'mrp' | 'stock'): string => serverErrors[`variants.${index}.${name}`] || (name !== 'mrp' && blank(form.variants[index][name]) ? 'This field is required' : '');

  const toInput = (): AdminProductInput => ({
    title: form.title,
    brandName: form.brandName,
    categoryId: form.categoryId,
    description: form.description,
    highlights: form.highlights.split('\n').map((h) => h.trim()).filter(Boolean),
    tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    status: form.status,
    variants: form.variants.map<AdminVariantInput>((v) => {
      const mrp = rupeesToPaise(v.mrp);
      return { ...(v.id ? { id: v.id } : {}), sku: v.sku, options: parseOptions(v.options), price: rupeesToPaise(v.price) ?? 0, ...(mrp !== undefined ? { mrp } : {}), stock: v.stock.trim() === '' ? -1 : Number(v.stock) };
    }),
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setServerErrors({});
    setTouched(true);
    setSaving(true);
    try {
      const input = toInput();
      const saved = id ? await firstValueFrom(api.update(id, input)) : await firstValueFrom(api.create(input));
      toast.success(id ? 'Product saved' : 'Product created');
      if (!id) navigate(`/products/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiException) {
        setFormError(error.message);
        setServerErrors(error.fields ?? {});
      } else {
        setFormError('Could not save the product.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (missing) return <NotFound />;
  if (loadError) return <ErrorState onRetry={detail.reload} />;
  if (!ready) return <Skeleton className="h-64" />;

  return (
    <>
      <Link to="/products" className="mb-2 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        ← Back to products
      </Link>
      <h1 className="mb-4 text-2xl font-bold">{id ? 'Edit product' : 'New product'}</h1>
      {formError && (
        <p className="mb-4 rounded-md border border-danger p-3 text-sm" role="alert">
          {formError}
        </p>
      )}
      <form onSubmit={save} noValidate className="max-w-4xl space-y-6">
        <section className="grid gap-4 md:grid-cols-2" aria-label="Details">
          <div className="md:col-span-2">
            <FormField label="Title" required error={err('title')}>
              {(f) => <input id={f.id} className={inputClass} maxLength={120} aria-describedby={f.describedBy} aria-invalid={err('title') ? 'true' : undefined} value={form.title} onChange={(e) => set('title', e.target.value)} />}
            </FormField>
          </div>
          <FormField label="Brand" required error={err('brandName')}>
            {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={err('brandName') ? 'true' : undefined} value={form.brandName} onChange={(e) => set('brandName', e.target.value)} />}
          </FormField>
          <FormField label="Category" required error={err('categoryId')} hint={id ? 'Category cannot be changed after creation.' : ''}>
            {(f) => (
              <select id={f.id} className={inputClass} disabled={!!id} aria-describedby={f.describedBy} aria-invalid={err('categoryId') ? 'true' : undefined} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Choose a category</option>
                {(categories.value ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Status">
            {(f) => (
              <select id={f.id} className={inputClass} value={form.status} onChange={(e) => set('status', e.target.value as ProductStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Tags (comma separated)">{(f) => <input id={f.id} className={inputClass} value={form.tags} onChange={(e) => set('tags', e.target.value)} />}</FormField>
          <div className="md:col-span-2">
            <FormField label="Description" error={err('description')} hint="Plain text. Leave a blank line between paragraphs.">
              {(f) => <textarea id={f.id} className={inputClass} rows={5} aria-describedby={f.describedBy} value={form.description} onChange={(e) => set('description', e.target.value)} />}
            </FormField>
          </div>
          <div className="md:col-span-2">
            <FormField label="Highlights (one per line)">{(f) => <textarea id={f.id} className={inputClass} rows={3} value={form.highlights} onChange={(e) => set('highlights', e.target.value)} />}</FormField>
          </div>
        </section>

        <section aria-labelledby="vh">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="vh" className="text-lg font-semibold">
              Variants
            </h2>
            <Button size="sm" variant="secondary" type="button" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, blankVariant()] }))}>
              Add variant
            </Button>
          </div>
          {serverErrors['variants'] && (
            <p className="mb-2 text-sm text-danger" role="alert">
              {serverErrors['variants']}
            </p>
          )}
          <div className="space-y-3">
            {form.variants.map((v, i) => (
              <fieldset key={v.key} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-6">
                <legend className="px-1 text-sm font-medium">Variant {i + 1}</legend>
                <div className="md:col-span-2">
                  <FormField label="SKU" required error={verr(i, 'sku')}>
                    {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={verr(i, 'sku') ? 'true' : undefined} value={v.sku} onChange={(e) => setVariant(v.key, { sku: e.target.value })} />}
                  </FormField>
                </div>
                <div className="md:col-span-2">
                  <FormField label="Options" hint="e.g. colour=Black; size=M">
                    {(f) => <input id={f.id} className={inputClass} aria-describedby={f.describedBy} value={v.options} onChange={(e) => setVariant(v.key, { options: e.target.value })} />}
                  </FormField>
                </div>
                <FormField label="Price (₹)" required error={verr(i, 'price')}>
                  {(f) => <input id={f.id} className={inputClass} inputMode="decimal" aria-describedby={f.describedBy} aria-invalid={verr(i, 'price') ? 'true' : undefined} value={v.price} onChange={(e) => setVariant(v.key, { price: e.target.value })} />}
                </FormField>
                <FormField label="MRP (₹)" error={verr(i, 'mrp')}>
                  {(f) => <input id={f.id} className={inputClass} inputMode="decimal" aria-describedby={f.describedBy} aria-invalid={verr(i, 'mrp') ? 'true' : undefined} value={v.mrp} onChange={(e) => setVariant(v.key, { mrp: e.target.value })} />}
                </FormField>
                <FormField label={v.id ? 'Stock (change in Inventory)' : 'Opening stock'} required error={verr(i, 'stock')}>
                  {/* Stock of an existing variant only changes through the inventory ledger, with a reason. */}
                  {(f) => <input id={f.id} className={inputClass} inputMode="numeric" disabled={!!v.id} aria-describedby={f.describedBy} aria-invalid={verr(i, 'stock') ? 'true' : undefined} value={v.stock} onChange={(e) => setVariant(v.key, { stock: e.target.value })} />}
                </FormField>
                {form.variants.length > 1 && (
                  <div className="flex items-end md:col-span-6">
                    <button type="button" className="min-h-11 text-sm font-medium text-danger hover:underline" onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((x) => x.key !== v.key) }))}>
                      Remove variant {i + 1}
                    </button>
                  </div>
                )}
              </fieldset>
            ))}
          </div>
        </section>

        <div className="flex gap-2">
          <Button type="submit" loading={saving}>
            {id ? 'Save changes' : 'Create product'}
          </Button>
          <ButtonLink variant="secondary" to="/products">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </>
  );
}
