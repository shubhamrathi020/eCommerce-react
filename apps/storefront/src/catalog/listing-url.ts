import type { ListingQuery, SortKey } from '@ecom/contracts';

/** Minimal read view of URL search params (Angular's `ParamMap` satisfies it). */
export interface ParamReader {
  get(name: string): string | null;
  readonly keys: string[];
}

export type UrlListingState = Pick<ListingQuery, 'q' | 'filters' | 'priceMin' | 'priceMax' | 'sort' | 'page'>;

export const DEFAULT_PAGE_SIZE = 24;
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest first' },
  { value: 'rating', label: 'Customer rating' },
  { value: 'discount', label: 'Discount' },
];

const SORTS = new Set<string>(SORT_OPTIONS.map((o) => o.value));
/** URL keys that are not facet filters. */
const RESERVED = new Set(['q', 'sort', 'page', 'price', 'variant']);

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `price=500-2000` in rupees (either side optional) to paise. */
function parsePrice(value: string | null): { priceMin?: number; priceMax?: number } {
  if (!value) return {};
  const [lo, hi] = value.split('-');
  const out: { priceMin?: number; priceMax?: number } = {};
  const min = Number.parseInt(lo ?? '', 10);
  const max = Number.parseInt(hi ?? '', 10);
  if (Number.isFinite(min) && min >= 0) out.priceMin = min * 100;
  if (Number.isFinite(max) && max >= 0) out.priceMax = max * 100;
  return out;
}

export function parseListingParams(params: ParamReader, defaultSort: SortKey = 'featured'): UrlListingState {
  const sort = params.get('sort');
  const filters: Record<string, string[]> = {};
  for (const key of params.keys) {
    if (RESERVED.has(key)) continue;
    const values = (params.get(key) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length) filters[key] = values;
  }
  return {
    q: params.get('q')?.trim() || undefined,
    filters,
    sort: sort && SORTS.has(sort) ? (sort as SortKey) : defaultSort,
    page: parsePositiveInt(params.get('page'), 1),
    ...parsePrice(params.get('price')),
  };
}

/** Inverse of `parseListingParams`. Defaults are omitted so URLs stay clean; unset keys are `null` (cleared by the router). */
export function toQueryParams(state: UrlListingState, previousKeys: string[] = [], defaultSort: SortKey = 'featured'): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of previousKeys) if (!RESERVED.has(key)) out[key] = null;
  out['q'] = state.q ?? null;
  out['sort'] = state.sort === defaultSort ? null : state.sort;
  out['page'] = state.page > 1 ? String(state.page) : null;
  out['price'] = state.priceMin !== undefined || state.priceMax !== undefined ? `${state.priceMin !== undefined ? Math.round(state.priceMin / 100) : ''}-${state.priceMax !== undefined ? Math.round(state.priceMax / 100) : ''}` : null;
  for (const [key, values] of Object.entries(state.filters)) if (values.length) out[key] = values.join(',');
  return out;
}

/** True when the URL carries anything beyond the plain category page (used to `noindex` filtered views). */
export function isRefined(state: UrlListingState, defaultSort: SortKey = 'featured'): boolean {
  return !!state.q || state.sort !== defaultSort || state.priceMin !== undefined || state.priceMax !== undefined || Object.keys(state.filters).length > 0;
}

/** Adapts the browser's `URLSearchParams` to the small read view above. */
export function paramReader(params: URLSearchParams): ParamReader {
  return { get: (name) => params.get(name), keys: [...new Set(params.keys())] };
}

/** `toQueryParams` result as a query string body (`null` entries are dropped). */
export function toSearchParams(values: Record<string, string | null>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null) out.set(key, value);
  return out;
}
