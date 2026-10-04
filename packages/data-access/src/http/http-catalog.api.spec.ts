import { provideHttpClient } from '@shop/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@shop/core/testing';
import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { ListingQuery } from '@ecom/contracts';
import { CatalogApi, CategoryApi, SearchApi, provideDataAccess } from '../index';

const BASE = 'http://api.test';

describe('HTTP adapters for catalog and search (realCatalog, BRD 20)', () => {
  let http: HttpTestingController;
  let catalog: CatalogApi;
  let category: CategoryApi;
  let search: SearchApi;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { useMocks: true, realCatalog: true, apiBaseUrl: `${BASE}/`, siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true, realCatalog: true }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    catalog = TestBed.inject(CatalogApi);
    category = TestBed.inject(CategoryApi);
    search = TestBed.inject(SearchApi);
  });
  afterEach(() => http.verify());

  it('fetches the home page with no auth needed', async () => {
    const result = firstValueFrom(catalog.home());
    const req = http.expectOne(`${BASE}/catalog/home`);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('authorization')).toBeNull();
    req.flush({ banners: [], categoryTiles: [], deals: { endsAt: '2026-01-01', items: [] }, rows: [], brands: [] });
    expect(await result).toMatchObject({ rows: [] });
  });

  it('encodes a listing query into the URL, including JSON-encoded filters', async () => {
    const query: ListingQuery = { categorySlug: 'men-clothing', q: 'shirt', filters: { brand: ['northline'] }, sort: 'price-asc', page: 2, pageSize: 12 };
    const result = firstValueFrom(catalog.listing(query));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/catalog/listing`));
    const params = new URL(req.request.url).searchParams;
    expect(params.get('categorySlug')).toBe('men-clothing');
    expect(params.get('q')).toBe('shirt');
    expect(JSON.parse(params.get('filters') ?? '{}')).toEqual({ brand: ['northline'] });
    expect(params.get('sort')).toBe('price-asc');
    expect(params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, pageSize: 12, facets: [], priceBounds: { min: 0, max: 0 }, title: 'x', breadcrumb: [] });
    expect((await result).page).toBe(2);
  });

  it('omits empty filters from the query string entirely', async () => {
    const result = firstValueFrom(catalog.listing({ filters: {}, sort: 'relevance', page: 1, pageSize: 24 }));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/catalog/listing`));
    const params = new URL(req.request.url).searchParams;
    expect(params.has('filters')).toBe(false);
    expect(params.has('categorySlug')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 24, facets: [], priceBounds: { min: 0, max: 0 }, title: 'x', breadcrumb: [] });
    await result;
  });

  it('looks up a product by slug and reports a redirect from an old slug', async () => {
    const result = firstValueFrom(catalog.product('old-slug'));
    const req = http.expectOne(`${BASE}/catalog/products/old-slug`);
    req.flush({ product: { id: 'p-1', slug: 'new-slug' }, redirectedFrom: 'old-slug' });
    expect(await result).toMatchObject({ redirectedFrom: 'old-slug' });
  });

  it('posts ids for bulk product/summary lookups', async () => {
    const result = firstValueFrom(catalog.productsByIds(['p-1', 'p-2']));
    const req = http.expectOne(`${BASE}/catalog/products/by-ids`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ids: ['p-1', 'p-2'] });
    req.flush([{ id: 'p-1' }, { id: 'p-2' }]);
    expect((await result).map((p) => p.id)).toEqual(['p-1', 'p-2']);
  });

  it('fetches reviews with sort/page/pageSize in the query string', async () => {
    const result = firstValueFrom(catalog.reviews('p-1', { sort: 'helpful', page: 1, pageSize: 5 }));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/catalog/products/p-1/reviews`));
    expect(new URL(req.request.url).searchParams.get('sort')).toBe('helpful');
    req.flush({ items: [], total: 0, summary: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] } });
    await result;
  });

  it('checks pin-code serviceability', async () => {
    const result = firstValueFrom(catalog.serviceability('560001'));
    const req = http.expectOne(`${BASE}/catalog/serviceability/560001`);
    req.flush({ serviceable: true, pincode: '560001' });
    expect(await result).toMatchObject({ serviceable: true });
  });

  it('fetches the category tree', async () => {
    const result = firstValueFrom(category.tree());
    http.expectOne(`${BASE}/catalog/categories/tree`).flush([{ id: 'c1', slug: 'fashion', name: 'Fashion', order: 1, children: [] }]);
    expect((await result)[0].slug).toBe('fashion');
  });

  it('fetches search suggestions and the popular-searches list', async () => {
    const suggestions = firstValueFrom(search.suggest('sh'));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/search/suggest`));
    expect(new URL(req.request.url).searchParams.get('q')).toBe('sh');
    req.flush({ queries: ['shirt'], products: [], categories: [], brands: [] });
    expect((await suggestions).queries).toEqual(['shirt']);

    const popular = firstValueFrom(search.popular());
    http.expectOne(`${BASE}/search/popular`).flush(['smartphone']);
    expect(await popular).toEqual(['smartphone']);
  });
});
