import { provideHttpClient } from '@shop/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@shop/core/testing';
import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { AdminProductApi, provideAdminDataAccess, provideDataAccess } from '../index';

const BASE = 'http://api.test';

describe('HttpAdminProductApi (realCatalog, BRD 20)', () => {
  let http: HttpTestingController;
  let admin: AdminProductApi;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { useMocks: true, realAuth: true, realCatalog: true, apiBaseUrl: `${BASE}/`, siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true, realAuth: true, realCatalog: true }),
        provideAdminDataAccess({ useMocks: true, realCatalog: true }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    admin = TestBed.inject(AdminProductApi);
  });
  afterEach(() => http.verify());

  it('lists products with filters in the query string, as the signed-in user', async () => {
    const result = firstValueFrom(admin.list({ q: 'shirt', status: 'draft', sort: 'title', dir: 'asc', page: 1, pageSize: 20 }));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/admin/products`) && !r.url.includes('/categories'));
    const params = new URL(req.request.url).searchParams;
    expect(params.get('q')).toBe('shirt');
    expect(params.get('status')).toBe('draft');
    req.flush({ items: [], total: 0, page: 1, pageSize: 20 });
    await result;
  });

  it('creates a product with a POST body', async () => {
    const input = { title: 'X', brandName: 'Y', categoryId: 'c1', description: '', highlights: [], tags: [], status: 'draft' as const, variants: [] };
    const result = firstValueFrom(admin.create(input));
    const req = http.expectOne(`${BASE}/admin/products`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'p-1', slug: 'x', ...input, categoryName: 'Y', variantAxes: [], updatedAt: '2026-01-01' });
    expect((await result).id).toBe('p-1');
  });

  it('maps the bulk-status/bulk-delete-drafts { count } response to a plain number', async () => {
    const status = firstValueFrom(admin.bulkSetStatus(['p-1', 'p-2'], 'archived'));
    http.expectOne(`${BASE}/admin/products/bulk-status`).flush({ count: 2 });
    expect(await status).toBe(2);

    const deleted = firstValueFrom(admin.bulkDeleteDrafts(['p-1']));
    http.expectOne(`${BASE}/admin/products/bulk-delete-drafts`).flush({ count: 1 });
    expect(await deleted).toBe(1);
  });
});
