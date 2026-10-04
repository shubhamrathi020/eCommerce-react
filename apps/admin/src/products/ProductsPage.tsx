import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, type AdminProductQuery, type ProductStatus } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useMoney, useResource, useService } from '@shop/core';
import { AdminProductApi } from '@shop/data-access';
import { Badge, Button, ButtonLink, EmptyState, ErrorState, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { useListParams } from '../lib/list-params';

const PAGE_SIZE = 20;
const TONES = { published: 'success', draft: 'warning', archived: 'neutral' } as const;
const STATUSES: ProductStatus[] = ['published', 'draft', 'archived'];
const SORTS = [
  { value: 'updated:desc', label: 'Recently updated' },
  { value: 'title:asc', label: 'Title A to Z' },
  { value: 'price:asc', label: 'Price low to high' },
  { value: 'price:desc', label: 'Price high to low' },
  { value: 'stock:asc', label: 'Stock low to high' },
];

export default function ProductsPage() {
  const api = useService(AdminProductApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const date = useDate();
  const money = useMoney();
  const list = useListParams();

  const q = list.str('q');
  const status = list.str('status') as ProductStatus | undefined;
  const sortKey = `${list.str('sort') ?? 'updated'}:${list.str('dir') ?? 'desc'}`;
  const pageNo = list.num('page', 1);
  const [draft, setDraft] = useState(q ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setDraft(q ?? ''), [q]);
  useEffect(() => {
    seo.set({ title: 'Products', noindex: true });
  }, [seo]);

  const [sort, dir] = sortKey.split(':') as [AdminProductQuery['sort'], 'asc' | 'desc'];
  const resource = useResource(() => api.list({ q, status, sort, dir, page: pageNo, pageSize: PAGE_SIZE }), [api, q, status, sort, dir, pageNo]);
  const page = resource.value;
  const allSelected = !!page && page.items.length > 0 && page.items.every((i) => selected.has(i.id));

  const toggle = (id: string) =>
    setSelected((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = (items: { id: string }[]) =>
    setSelected((set) => {
      const next = new Set(set);
      const all = items.every((i) => next.has(i.id));
      for (const i of items) {
        if (all) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });

  const run = async (action: () => Promise<number>, message: (n: number) => string) => {
    try {
      toast.success(message(await action()));
      setSelected(new Set());
      resource.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'The action failed.');
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Products</h1>
        <ButtonLink to="/products/new">New product</ButtonLink>
      </div>

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter products"
        onSubmit={(e) => {
          e.preventDefault();
          list.patch({ q: draft.trim() || null });
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input id="q" className={inputClass} type="search" placeholder="Title, brand or SKU" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select id="status" className={inputClass} value={status ?? ''} onChange={(e) => list.patch({ status: e.target.value || null })}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="mb-1 block text-sm font-medium">
            Sort by
          </label>
          <select
            id="sort"
            className={inputClass}
            value={sortKey}
            onChange={(e) => {
              const [s, d] = e.target.value.split(':');
              list.patch({ sort: s, dir: d });
            }}
          >
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-surface-alt p-3" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          <Button size="sm" type="button" onClick={() => void run(() => firstValueFrom(api.bulkSetStatus([...selected], 'published')), (n) => `${n} product(s) set to published`)}>
            Publish
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => void run(() => firstValueFrom(api.bulkSetStatus([...selected], 'archived')), (n) => `${n} product(s) set to archived`)}>
            Archive
          </Button>
          {!confirmDelete ? (
            <Button size="sm" variant="danger" type="button" onClick={() => setConfirmDelete(true)}>
              Delete drafts
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="danger"
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  void run(() => firstValueFrom(api.bulkDeleteDrafts([...selected])), (n) => `${n} draft product(s) deleted (only drafts can be deleted)`);
                }}
              >
                Confirm: delete selected drafts
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" type="button" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {page ? (
        page.items.length === 0 ? (
          <EmptyState title="No products found" description="Try a different search or filter." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[46rem] text-start text-sm">
                <caption className="sr-only">Products</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    <th scope="col" className="w-10 p-2">
                      <input type="checkbox" className="size-5 accent-primary" aria-label="Select all on this page" checked={allSelected} onChange={() => toggleAll(page.items)} />
                    </th>
                    <th scope="col" className="p-2 text-start">Product</th>
                    <th scope="col" className="p-2 text-start">Status</th>
                    <th scope="col" className="p-2 text-end">From price</th>
                    <th scope="col" className="p-2 text-end">Stock</th>
                    <th scope="col" className="p-2 text-start">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {page.items.map((row) => (
                    <tr key={row.id}>
                      <td className="p-2">
                        <input type="checkbox" className="size-5 accent-primary" aria-label={`Select ${row.title}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-3">
                          <img src={row.image.url} width={40} height={40} alt="" className="size-10 rounded object-cover" />
                          <span className="min-w-0">
                            <Link to={`/products/${row.id}`} className="block truncate font-medium text-primary hover:underline">
                              {row.title}
                            </Link>
                            <span className="text-xs text-text-muted">
                              {row.brandName} · {row.categoryName} · {row.variantCount} variant(s)
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="p-2">
                        <Badge tone={TONES[row.status]}>{row.status}</Badge>
                      </td>
                      <td className="p-2 text-end">{money(row.priceMin)}</td>
                      <td className={cx('p-2 text-end', row.stockTotal === 0 && 'text-danger')}>{row.stockTotal}</td>
                      <td className="p-2 text-text-muted">{date(row.updatedAt, 'd MMM y')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {page.total} products
            </p>
            <div className="mt-4">
              <Pagination page={page.page} pageSize={page.pageSize} total={page.total} />
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
