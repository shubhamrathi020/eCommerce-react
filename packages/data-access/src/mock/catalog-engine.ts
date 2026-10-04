import type {
  Brand,
  Category,
  CategoryRef,
  Collection,
  Facet,
  ListingQuery,
  ListingResult,
  Product,
} from '@ecom/contracts';
import { ApiException, LOW_STOCK_THRESHOLD, bestDiscount, cheapestVariant, sortProducts, stockStatusOf, toSummary } from '@ecom/contracts';
import { buildIndex, searchProducts } from './search-engine';

// Re-exported so existing imports of this module keep working; the rules themselves now live in
// @ecom/contracts (catalog-derive.ts) so apps/api can reuse them too (steering/memory.md).
export { LOW_STOCK_THRESHOLD, bestDiscount, sortProducts, stockStatusOf, toSummary };

export interface CatalogData {
  products: Product[];
  categories: Category[];
  brands: Brand[];
  collections: Collection[];
}

const totalStock = (p: Product): number => p.variants.reduce((sum, v) => sum + v.stock, 0);

// ---------- listing ----------

type Predicate = (p: Product) => boolean;

const brandSlugOf = (p: Product): string => p.brandId.replace(/^brand-/, '');

function attributeValuesOf(p: Product, key: string, isAxis: boolean): string[] {
  if (isAxis) return [...new Set(p.variants.map((v) => v.options[key]).filter((v): v is string => v !== undefined))];
  const value = p.attributes[key];
  return value === undefined ? [] : [String(value)];
}

const RATING_STEPS = [4, 3, 2, 1];
const DISCOUNT_STEPS = [10, 25, 40];

function leafIdsUnder(category: Category, categories: Category[]): Set<string> {
  const children = categories.filter((c) => c.parentId === category.id);
  return new Set(children.length ? children.map((c) => c.id) : [category.id]);
}

export function runListing(data: CatalogData, query: ListingQuery): ListingResult {
  let scope = data.products;
  let heading = 'All products';
  let breadcrumb: CategoryRef[] = [];
  let attributeDefs: NonNullable<Category['attributeDefs']> = [];

  if (query.categorySlug) {
    const category = data.categories.find((c) => c.slug === query.categorySlug);
    if (!category) throw new ApiException('not_found', 'Category not found');
    const ids = leafIdsUnder(category, data.categories);
    scope = scope.filter((p) => ids.has(p.categoryId));
    heading = category.name;
    const parent = category.parentId ? data.categories.find((c) => c.id === category.parentId) : undefined;
    breadcrumb = [...(parent ? [{ id: parent.id, slug: parent.slug, name: parent.name }] : []), { id: category.id, slug: category.slug, name: category.name }];
    // Attribute facets only make sense inside a single leaf category.
    if (category.attributeDefs) attributeDefs = category.attributeDefs.filter((d) => d.filterable);
  }
  if (query.brandSlug) {
    const brand = data.brands.find((b) => b.slug === query.brandSlug);
    if (!brand) throw new ApiException('not_found', 'Brand not found');
    scope = scope.filter((p) => p.brandId === brand.id);
    heading = brand.name;
  }
  if (query.collectionSlug) {
    const collection = data.collections.find((c) => c.slug === query.collectionSlug);
    if (!collection) throw new ApiException('not_found', 'Collection not found');
    scope = scope.filter((p) => p.tags.includes(collection.tag));
    heading = collection.name;
  }
  let scores: Map<string, number> | undefined;
  let correctedFrom: string | undefined;
  if (query.q?.trim()) {
    const matches = searchProducts(buildIndex(data.products), scope, query.q);
    scope = matches.products;
    scores = matches.scores;
    correctedFrom = matches.correctedFrom;
    heading = `Results for "${matches.usedQuery}"`;
  }

  // Predicates per facet group, so each facet can be counted ignoring its own selection.
  const predicates: Record<string, Predicate> = {};
  const sel = query.filters;
  if (sel['brand']?.length) predicates['brand'] = (p) => sel['brand'].includes(brandSlugOf(p));
  if (sel['rating']?.length) {
    const min = Math.min(...sel['rating'].map(Number));
    predicates['rating'] = (p) => p.rating.average >= min;
  }
  if (sel['availability']?.includes('in_stock')) predicates['availability'] = (p) => totalStock(p) > 0;
  if (sel['discount']?.length) {
    const min = Math.min(...sel['discount'].map(Number));
    predicates['discount'] = (p) => bestDiscount(p) >= min;
  }
  for (const def of attributeDefs) {
    const chosen = sel[def.key];
    if (chosen?.length) predicates[def.key] = (p) => attributeValuesOf(p, def.key, def.variantAxis).some((v) => chosen.includes(v));
  }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    const lo = query.priceMin ?? 0;
    const hi = query.priceMax ?? Number.MAX_SAFE_INTEGER;
    predicates['price'] = (p) => p.variants.some((v) => v.price.amount >= lo && v.price.amount <= hi);
  }

  const matching = (ignore?: string): Product[] =>
    scope.filter((p) => Object.entries(predicates).every(([key, pred]) => key === ignore || pred(p)));

  // Facets
  const facets: Facet[] = [];
  const brandItems = matching('brand');
  const brandCounts = new Map<string, number>();
  for (const p of brandItems) brandCounts.set(brandSlugOf(p), (brandCounts.get(brandSlugOf(p)) ?? 0) + 1);
  facets.push({
    key: 'brand',
    label: 'Brand',
    options: [...brandCounts.entries()]
      .map(([slug, count]) => ({ value: slug, label: data.brands.find((b) => b.slug === slug)?.name ?? slug, count, selected: !!sel['brand']?.includes(slug) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  });
  for (const def of attributeDefs) {
    const items = matching(def.key);
    const counts = new Map<string, number>();
    for (const p of items) for (const v of attributeValuesOf(p, def.key, def.variantAxis)) counts.set(v, (counts.get(v) ?? 0) + 1);
    const options = [...counts.entries()]
      .map(([value, count]) => ({ value, label: value, count, selected: !!sel[def.key]?.includes(value) }))
      .sort((a, b) => (def.values ? def.values.indexOf(a.value) - def.values.indexOf(b.value) : a.label.localeCompare(b.label)));
    if (options.length > 1 || options.some((o) => o.selected)) facets.push({ key: def.key, label: def.label, options });
  }
  const ratingItems = matching('rating');
  facets.push({
    key: 'rating',
    label: 'Customer rating',
    options: RATING_STEPS.map((n) => ({ value: String(n), label: `${n} stars & up`, count: ratingItems.filter((p) => p.rating.average >= n).length, selected: !!sel['rating']?.includes(String(n)) })),
  });
  const discountItems = matching('discount');
  facets.push({
    key: 'discount',
    label: 'Discount',
    options: DISCOUNT_STEPS.map((n) => ({ value: String(n), label: `${n}% or more`, count: discountItems.filter((p) => bestDiscount(p) >= n).length, selected: !!sel['discount']?.includes(String(n)) })),
  });
  const stockItems = matching('availability');
  facets.push({
    key: 'availability',
    label: 'Availability',
    options: [{ value: 'in_stock', label: 'In stock only', count: stockItems.filter((p) => totalStock(p) > 0).length, selected: !!sel['availability']?.includes('in_stock') }],
  });

  // Price bounds (ignoring the price filter itself)
  const priceItems = matching('price');
  const allPrices = priceItems.flatMap((p) => p.variants.map((v) => v.price.amount));
  const priceBounds = allPrices.length ? { min: Math.min(...allPrices), max: Math.max(...allPrices) } : { min: 0, max: 0 };

  // Sort, paginate
  const items = sortProducts(matching(), query.sort, scores);
  const pageSize = Math.max(1, query.pageSize);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, query.page), pages);

  return {
    items: items.slice((page - 1) * pageSize, page * pageSize).map(toSummary),
    total: items.length,
    page,
    pageSize,
    facets,
    priceBounds,
    title: heading,
    breadcrumb,
    ...(correctedFrom ? { correctedFrom } : {}),
  };
}
