import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { ListingQuery } from '@ecom/contracts';
import { CatalogApi, provideDataAccess } from '../index';

const base: ListingQuery = { filters: {}, sort: 'featured', page: 1, pageSize: 24 };

describe('MockCatalogApi', () => {
  let api: CatalogApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true }),
      ],
    });
    api = TestBed.inject(CatalogApi);
  });

  const list = (q: Partial<ListingQuery> = {}) => firstValueFrom(api.listing({ ...base, ...q }));

  it('lists all products with pagination', async () => {
    const r = await list();
    expect(r.total).toBeGreaterThan(200);
    expect(r.items).toHaveLength(24);
    const last = await list({ page: 999 });
    expect(last.page).toBeGreaterThan(1);
    expect(last.items.length).toBeGreaterThan(0);
  });

  it('scopes a root category to its sub-categories and gives a breadcrumb', async () => {
    const r = await list({ categorySlug: 'fashion', pageSize: 100 });
    // Six sub-categories of six products, plus the one live seller listing in the demo marketplace (BRD 17).
    expect(r.total).toBe(6 * 6 + 1);
    expect(r.breadcrumb.map((c) => c.slug)).toEqual(['fashion']);
    expect(r.facets.some((f) => f.key === 'brand')).toBe(true);
  });

  it('offers attribute facets on a leaf category and filters by them', async () => {
    const all = await list({ categorySlug: 'mobiles', pageSize: 100 });
    const ram = all.facets.find((f) => f.key === 'ram');
    expect(ram).toBeDefined();
    const pick = ram!.options[0];
    const filtered = await list({ categorySlug: 'mobiles', pageSize: 100, filters: { ram: [pick.value] } });
    expect(filtered.total).toBe(pick.count);
  });

  it('counts a facet ignoring its own selection so multi-select stays usable', async () => {
    const all = await list({ categorySlug: 'footwear', pageSize: 100 });
    const brand = all.facets.find((f) => f.key === 'brand')!.options[0];
    const filtered = await list({ categorySlug: 'footwear', pageSize: 100, filters: { brand: [brand.value] } });
    const again = filtered.facets.find((f) => f.key === 'brand')!;
    expect(again.options.length).toBe(all.facets.find((f) => f.key === 'brand')!.options.length);
    expect(again.options.find((o) => o.value === brand.value)?.selected).toBe(true);
  });

  it('filters by price range and reports bounds independent of that filter', async () => {
    const all = await list({ categorySlug: 'audio-and-headphones', pageSize: 100 });
    const mid = Math.round((all.priceBounds.min + all.priceBounds.max) / 2);
    const cheap = await list({ categorySlug: 'audio-and-headphones', pageSize: 100, priceMax: mid });
    expect(cheap.total).toBeLessThanOrEqual(all.total);
    expect(cheap.priceBounds).toEqual(all.priceBounds);
  });

  it('sorts by price ascending with out-of-stock items last', async () => {
    const r = await list({ categorySlug: 'laptops', sort: 'price-asc', pageSize: 100 });
    const inStock = r.items.filter((i) => i.stockStatus !== 'out_of_stock');
    const prices = inStock.map((i) => i.priceMin.amount);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const firstOos = r.items.findIndex((i) => i.stockStatus === 'out_of_stock');
    if (firstOos >= 0) expect(r.items.slice(firstOos).every((i) => i.stockStatus === 'out_of_stock')).toBe(true);
  });

  it('supports brand, collection and query scopes and reports not_found', async () => {
    const trending = await list({ collectionSlug: 'trending', pageSize: 100 });
    expect(trending.total).toBeGreaterThan(0);
    expect(trending.title).toBe('Trending now');
    const search = await list({ q: 'sneakers', pageSize: 100 });
    expect(search.items.length).toBeGreaterThan(0);
    expect(search.items.some((i) => /sneaker|shoe|trainer/.test(i.title.toLowerCase()) || i.categoryName === 'Footwear')).toBe(true); // synonyms widen the match (e.g. shoe rack)
    await expect(list({ categorySlug: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(list({ brandSlug: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
    const brand = (await list()).facets.find((f) => f.key === 'brand')!.options[0];
    expect((await list({ brandSlug: brand.value })).total).toBeGreaterThan(0);
  });

  it('returns a product by slug and 404s unknown slugs', async () => {
    const first = (await list()).items[0];
    const { product } = await firstValueFrom(api.product(first.slug));
    expect(product.id).toBe(first.id);
    expect(product.variants.length).toBeGreaterThan(0);
    await expect(firstValueFrom(api.product('nope'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('builds the home page data', async () => {
    const home = await firstValueFrom(api.home());
    expect(home.banners.length).toBeGreaterThan(0);
    expect(home.categoryTiles).toHaveLength(8);
    expect(home.deals.items.length).toBeGreaterThan(0);
    expect(home.rows.every((r) => r.items.length > 0)).toBe(true);
  });

  it('pages reviews and validates pin codes', async () => {
    const first = (await list({ sort: 'rating' })).items[0];
    const page = await firstValueFrom(api.reviews(first.id, { sort: 'helpful', page: 1, pageSize: 5 }));
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.total).toBe(page.summary.count);
    await expect(firstValueFrom(api.serviceability('12'))).rejects.toMatchObject({ code: 'validation' });
    expect((await firstValueFrom(api.serviceability('560001'))).serviceable).toBe(true);
    expect((await firstValueFrom(api.serviceability('900001'))).serviceable).toBe(false);
  });

  it('related products exclude the product itself', async () => {
    const first = (await list()).items[0];
    const related = await firstValueFrom(api.related(first.id));
    expect(related.length).toBeGreaterThan(0);
    expect(related.some((r) => r.id === first.id)).toBe(false);
  });
});
