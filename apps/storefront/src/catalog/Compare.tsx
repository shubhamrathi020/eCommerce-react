import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import type { CategoryNode, Product } from '@ecom/contracts';
import { BottomBarService, CompareStore, ConsentService, SeoService, useResource, useService, useSignal } from '@shop/core';
import { CatalogApi, CategoryApi } from '@shop/data-access';
import { Button, ButtonLink, EmptyState, Price, Rating, Skeleton, cx } from '@shop/ui';

interface Row {
  label: string;
  values: string[];
  differs: boolean;
}

const flatten = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const minPrice = (p: Product) => p.variants.reduce((a, b) => (b.price.amount < a.price.amount ? b : a)).price;

/** Side-by-side comparison of up to four products, highlighting rows where values differ. */
export default function ComparePage() {
  const store = useService(CompareStore);
  const api = useService(CatalogApi);
  const categoryApi = useService(CategoryApi);
  const seo = useService(SeoService);
  const ids = useSignal(store.ids);
  const resource = useResource(() => api.productsByIds(ids), [api, ids.join(',')], ids.length > 0);
  const categories = useResource(() => categoryApi.tree(), [categoryApi]);
  const products: Product[] = ids.length > 0 ? (resource.value ?? []) : [];

  useEffect(() => {
    seo.set({ title: 'Compare products', noindex: true, path: '/compare' });
  }, [seo]);

  const rows = useMemo<Row[]>(() => {
    // Attribute labels and value order come from each product's own category (keys are reused across categories).
    const defsOf = new Map<string, Map<string, { label: string; values?: string[] }>>();
    if (categories.value) {
      for (const cat of flatten(categories.value)) defsOf.set(cat.id, new Map((cat.attributeDefs ?? []).map((d) => [d.key, d])));
    }
    const keys = [...new Set(products.flatMap((p) => [...p.variantAxes, ...Object.keys(p.attributes)]))];
    return keys.map((key) => {
      const label = products.map((p) => defsOf.get(p.categoryId)?.get(key)?.label).find(Boolean) ?? key;
      const values = products.map((p) => {
        if (key in p.attributes) return String(p.attributes[key]);
        if (!p.variantAxes.includes(key)) return '-';
        const order = defsOf.get(p.categoryId)?.get(key)?.values ?? [];
        const present = [...new Set(p.variants.map((v) => v.options[key]))];
        return present.sort((x, y) => order.indexOf(x) - order.indexOf(y)).join(', ');
      });
      return { label, values, differs: new Set(values).size > 1 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.value, ids.length, categories.value]);

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Compare products</h1>
      {ids.length === 0 ? (
        <EmptyState title="Nothing to compare yet" description="Tick “Compare” on up to four products to see them side by side.">
          <ButtonLink to="/">Continue shopping</ButtonLink>
        </EmptyState>
      ) : products.length === 0 ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-start text-sm">
              <caption className="sr-only">Product comparison</caption>
              <thead>
                <tr>
                  <td className="w-32 p-2" />
                  {products.map((p) => (
                    <th key={p.id} scope="col" className="w-1/4 p-2 text-start align-top font-normal">
                      <img src={p.images[0].url} width={p.images[0].width} height={p.images[0].height} alt={p.images[0].alt} className="mb-2 aspect-square w-full rounded-md object-cover" />
                      <Link to={`/p/${p.slug}`} className="font-medium hover:text-primary hover:underline">
                        {p.title}
                      </Link>
                      <button type="button" className="mt-1 block min-h-11 text-sm text-danger hover:underline" onClick={() => store.remove(p.id)}>
                        Remove <span className="sr-only">{p.title}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <th scope="row" className="p-2 text-start font-medium text-text-muted">
                    Price
                  </th>
                  {products.map((p) => (
                    <td key={p.id} className="p-2">
                      <Price price={minPrice(p)} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="p-2 text-start font-medium text-text-muted">
                    Rating
                  </th>
                  {products.map((p) => (
                    <td key={p.id} className="p-2">
                      {p.rating.count ? <Rating value={p.rating.average} count={p.rating.count} size={14} /> : <span className="text-text-muted">No reviews</span>}
                    </td>
                  ))}
                </tr>
                {rows.map((row) => (
                  <tr key={row.label} className={cx(row.differs && 'bg-surface-alt')}>
                    <th scope="row" className="p-2 text-start font-medium text-text-muted">
                      {row.label}
                      {row.differs && <span className="sr-only"> (differs)</span>}
                    </th>
                    {row.values.map((value, i) => (
                      <td key={i} className={cx('p-2', row.differs && 'font-semibold')}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="secondary" type="button" className="mt-4" onClick={() => store.clear()}>
            Clear all
          </Button>
        </>
      )}
    </>
  );
}

/**
 * Sticky bar that appears once at least one product is chosen for comparison.
 * Stays out of the way of the cookie banner (consent comes first) and, on mobile only, of a page's own full-width action bar
 * such as the product page's "Add to cart" (there is only room for one).
 */
export function CompareBar() {
  const store = useService(CompareStore);
  const consent = useService(ConsentService);
  const bottomBar = useService(BottomBarService);
  const count = useSignal(store.count);
  const needsDecision = useSignal(consent.needsDecision);
  const pageHasBar = useSignal(bottomBar.primaryActionVisible);
  if (count === 0 || needsDecision) return null;
  return (
    <div
      className={cx('print:hidden fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3 shadow-modal md:bottom-4 md:start-auto md:end-4 md:w-80 md:rounded-lg md:border', pageHasBar && 'max-md:hidden')}
      role="region"
      aria-label="Compare products"
    >
      <p className="mb-2 text-sm" aria-live="polite">
        {count} of {store.limit} products selected
      </p>
      <div className="flex gap-2">
        <ButtonLink to="/compare" size="sm" className="flex-1">
          Compare now
        </ButtonLink>
        <Button size="sm" variant="secondary" type="button" onClick={() => store.clear()}>
          Clear
        </Button>
      </div>
    </div>
  );
}
