import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiException, type ListingQuery, type ListingResult, type ProductSummary, type SortKey } from '@ecom/contracts';
import { AnalyticsService, SeoService, useResource, useService } from '@shop/core';
import { CatalogApi, SearchApi } from '@shop/data-access';
import { Breadcrumb, Button, ButtonLink, Chip, Drawer, EmptyState, ErrorState, NotFound, Pagination, Skeleton, cx, inputClass } from '@shop/ui';
import { FilterPanel, type PriceRange } from './FilterPanel';
import { ActionCard, RecentlyViewed } from './ProductRows';
import { DEFAULT_PAGE_SIZE, SORT_OPTIONS, isRefined, paramReader, parseListingParams, toQueryParams, toSearchParams, type UrlListingState } from './listing-url';

export type ListingKind = 'category' | 'brand' | 'collection' | 'search';

interface FilterChip {
  id: string;
  label: string;
  key: string;
  value?: string;
}

const PREFIX: Record<ListingKind, string> = { category: '/c', brand: '/b', collection: '/collections', search: '/search' };

/** Category, brand, collection and search results. The URL is the single source of truth for filters, sort and page. */
function Listing({ kind, slug }: { kind: ListingKind; slug?: string }) {
  const api = useService(CatalogApi);
  const searchApi = useService(SearchApi);
  const seo = useService(SeoService);
  const analytics = useService(AnalyticsService);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const defaultSort: SortKey = kind === 'search' ? 'relevance' : 'featured';
  const sortOptions = SORT_OPTIONS.filter((o) => o.value !== (kind === 'search' ? 'featured' : 'relevance'));
  const state = useMemo<UrlListingState>(() => parseListingParams(paramReader(params), defaultSort), [params, defaultSort]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useMemo<ListingQuery>(() => {
    const scope: Partial<ListingQuery> = {};
    if (kind === 'category') scope.categorySlug = slug;
    if (kind === 'brand') scope.brandSlug = slug;
    if (kind === 'collection') scope.collectionSlug = slug;
    return { ...state, ...scope, pageSize: DEFAULT_PAGE_SIZE };
  }, [state, kind, slug]);
  const queryKey = JSON.stringify(query);

  const result = useResource(() => api.listing(query), [api, queryKey]);
  const popular = useResource(() => searchApi.popular(), [searchApi], kind === 'search').value ?? [];

  /** Keeps the previous page on screen while the next one loads, avoiding a flash of skeletons. */
  const shownRef = useRef<ListingResult | undefined>(undefined);
  if (result.value) shownRef.current = result.value;
  const shown = result.value ?? shownRef.current;

  /**
   * On mobile, "Load more" keeps appending pages to this instead of replacing them, so the on-screen list grows; a real query
   * change (new filters, sort or search) or a page going backwards (the browser back button) resets it to just that one page.
   */
  const baseKey = useMemo(() => {
    const { page: _page, ...rest } = query;
    return JSON.stringify(rest);
  }, [query]);
  const [acc, setAcc] = useState<{ key: string; page: number; items: ProductSummary[]; priorityIds: ReadonlySet<string> }>({ key: '', page: 0, items: [], priorityIds: new Set() });
  useEffect(() => {
    const r = result.value;
    if (!r) return;
    setAcc((prev) => {
      const append = prev.key === baseKey && state.page === prev.page + 1;
      return { key: baseKey, page: state.page, items: append ? [...prev.items, ...r.items] : r.items, priorityIds: append ? prev.priorityIds : new Set(r.items.slice(0, 4).map((p) => p.id)) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.value]);
  const listItems = acc.key === baseKey && acc.items.length ? acc.items : (shown?.items ?? []);

  const notFound = result.status === 'error' && result.error instanceof ApiException && result.error.code === 'not_found';
  const pages = Math.max(1, Math.ceil((shown?.total ?? 0) / (shown?.pageSize ?? 1)));

  const chips = useMemo<FilterChip[]>(() => {
    if (!shown) return [];
    const out: FilterChip[] = [];
    for (const facet of shown.facets) {
      for (const option of facet.options) {
        if (option.selected) out.push({ id: `${facet.key}:${option.value}`, label: `${facet.label}: ${option.label}`, key: facet.key, value: option.value });
      }
    }
    if (state.priceMin !== undefined || state.priceMax !== undefined) {
      out.push({ id: 'price', label: `Price: ₹${state.priceMin !== undefined ? Math.round(state.priceMin / 100) : 0} - ${state.priceMax !== undefined ? '₹' + Math.round(state.priceMax / 100) : 'any'}`, key: 'price' });
    }
    return out;
  }, [shown, state.priceMin, state.priceMax]);

  const basePath = kind === 'search' ? PREFIX.search : `${PREFIX[kind]}/${slug}`;

  useEffect(() => {
    if (!shown) return;
    seo.set({
      title: shown.title + (state.page > 1 ? ` - Page ${state.page}` : ''),
      description: `Shop ${shown.title} online. ${shown.total} products with fast delivery and easy returns.`,
      path: state.page > 1 ? `${basePath}?page=${state.page}` : basePath,
      noindex: isRefined(state, defaultSort) || kind === 'search',
    });
  }, [shown, state, basePath, defaultSort, kind, seo]);

  // Search analytics: term is length-limited and only sent with consent (see AnalyticsService).
  useEffect(() => {
    const term = state.q;
    if (kind !== 'search' || !result.value || !term) return;
    analytics.track({ name: result.value.total === 0 ? 'search_zero_results' : 'search', props: { term: term.slice(0, 50), results: result.value.total } });
  }, [result.value, kind, state.q, analytics]);

  const update = useCallback(
    (next: UrlListingState) => {
      const search = toSearchParams(toQueryParams(next, [...params.keys()], defaultSort)).toString();
      navigate({ search: search ? `?${search}` : '' });
    },
    [navigate, params, defaultSort],
  );

  const toggleOption = (key: string, value: string) => {
    const current = state.filters[key] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    update({ ...state, filters: { ...state.filters, [key]: next }, page: 1 });
  };
  const setPrice = (range: PriceRange) => update({ ...state, priceMin: range.min !== undefined ? range.min * 100 : undefined, priceMax: range.max !== undefined ? range.max * 100 : undefined, page: 1 });
  const removeChip = (chip: FilterChip) => {
    if (chip.key === 'price') update({ ...state, priceMin: undefined, priceMax: undefined, page: 1 });
    else if (chip.value) toggleOption(chip.key, chip.value);
  };
  const clearAll = () => update({ filters: {}, sort: state.sort, page: 1, q: state.q });

  // "Load more" is a real link (crawlable, works without JS); this only stops the router's normal scroll-to-top for that one
  // navigation, so the shopper stays where they were.
  const loadMoreHref = useMemo(() => {
    const next = new URLSearchParams(params);
    next.set('page', String((shown?.page ?? 1) + 1));
    return `?${next.toString()}`;
  }, [params, shown?.page]);
  const rememberScroll = () => {
    const y = window.scrollY;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  };

  /** A click on a product link in search results counts toward the term's click-through rate. */
  const resultClicked = (event: React.MouseEvent) => {
    const term = state.q;
    if (kind !== 'search' || !term) return;
    // Only links inside the results grid count, not header or filter links.
    const link = (event.target as HTMLElement | null)?.closest('[data-results] a[href^="/p/"]');
    if (link) analytics.track({ name: 'search_result_click', props: { term: term.slice(0, 50) } });
  };

  if (notFound) return <NotFound />;
  if (!shown) {
    if (result.status === 'error') return <ErrorState onRetry={result.reload} />;
    return (
      <>
        <Skeleton className="mb-4 h-8 w-1/3" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4]" />
          ))}
        </div>
      </>
    );
  }

  const crumbs = [{ label: 'Home', link: '/' }, ...shown.breadcrumb.map((c, i, all) => (i === all.length - 1 ? { label: c.name } : { label: c.name, link: `/c/${c.slug}` }))];
  const filterPanel = (idPrefix: string) => <FilterPanel idPrefix={idPrefix} facets={shown.facets} priceBounds={shown.priceBounds} priceMin={state.priceMin} priceMax={state.priceMax} onOptionToggle={toggleOption} onPrice={setPrice} />;

  return (
    <div onClick={resultClicked}>
      {shown.breadcrumb.length > 0 && (
        <div className="mb-3">
          <Breadcrumb items={crumbs} />
        </div>
      )}
      {shown.correctedFrom && (
        <p className="mb-3 rounded-md bg-surface-alt p-3 text-sm" role="status">
          No exact matches for “{shown.correctedFrom}”. Showing the closest results instead.
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{shown.title}</h1>
          <p className="text-sm text-text-muted" aria-live="polite">
            {shown.total} {shown.total === 1 ? 'product' : 'products'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" type="button" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
            Filters{chips.length > 0 && ` (${chips.length})`}
          </Button>
          <label className="sr-only" htmlFor="sort">
            Sort by
          </label>
          <select id="sort" className={cx(inputClass, '!w-auto')} value={state.sort} onChange={(e) => update({ ...state, sort: e.target.value as SortKey, page: 1 })}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
          {chips.map((chip) => (
            <Chip key={chip.id} label={chip.label} onRemove={() => removeChip(chip)}>
              {chip.label}
            </Chip>
          ))}
          <button type="button" className="min-h-11 px-2 text-sm font-medium text-primary hover:underline" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          {filterPanel('fd')}
        </aside>

        <section aria-label="Products" aria-busy={result.loading}>
          {shown.items.length > 0 ? (
            <>
              <ul className={cx('grid grid-cols-2 gap-3 transition-opacity md:grid-cols-3 md:gap-4 xl:grid-cols-4', result.loading && 'opacity-50')} data-results>
                {listItems.map((product) => (
                  <li key={product.id}>
                    <ActionCard product={product} priority={acc.priorityIds.has(product.id)} />
                  </li>
                ))}
              </ul>
              <div className="mt-8 hidden lg:block">
                <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} />
              </div>
              {shown.page < pages ? (
                <Link to={loadMoreHref} onClick={rememberScroll} aria-busy={result.loading} className="mt-8 block w-full rounded-md border border-border-strong px-4 py-2.5 text-center font-medium hover:bg-surface-alt lg:hidden">
                  {result.loading ? 'Loading…' : 'Load more'}
                </Link>
              ) : (
                listItems.length > shown.pageSize && <p className="mt-8 text-center text-sm text-text-muted lg:hidden">You've seen every result.</p>
              )}
            </>
          ) : (
            <EmptyState title={kind === 'search' && !chips.length ? `No results for “${state.q ?? ''}”` : 'No products match your filters'} description="Check the spelling, try a more general word, or remove a filter.">
              {chips.length > 0 && (
                <Button variant="secondary" type="button" onClick={clearAll}>
                  Clear all filters
                </Button>
              )}
              {kind === 'search' && popular.length > 0 && (
                <>
                  <p className="mt-4 text-sm font-medium">Popular searches</p>
                  <ul className="mt-2 flex flex-wrap justify-center gap-2">
                    {popular.map((term) => (
                      <li key={term}>
                        <ButtonLink to={`/search?q=${encodeURIComponent(term)}`} variant="ghost" className="rounded-full border border-border-strong">
                          {term}
                        </ButtonLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </EmptyState>
          )}
        </section>
      </div>

      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} label="Filters" side="left">
        {filterPanel('fm')}
        <Button type="button" className="mt-4 w-full" onClick={() => setFiltersOpen(false)}>
          Show {shown.total} results
        </Button>
      </Drawer>

      <div className="mt-12">
        <RecentlyViewed />
      </div>
    </div>
  );
}

export function CategoryListing() {
  const { slug } = useParams();
  return <Listing kind="category" slug={slug} key={`c-${slug}`} />;
}
export function BrandListing() {
  const { slug } = useParams();
  return <Listing kind="brand" slug={slug} key={`b-${slug}`} />;
}
export function CollectionListing() {
  const { slug } = useParams();
  return <Listing kind="collection" slug={slug} key={`l-${slug}`} />;
}
export function SearchListing() {
  return <Listing kind="search" />;
}
