import { provideHttpClient } from '@shop/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@shop/core/testing';
import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { AdminOrderApi, provideAdminDataAccess, provideDataAccess } from '../index';

const BASE = 'http://api.test';

describe('HttpAdminOrderApi (realCommerce, BRD 21)', () => {
  let http: HttpTestingController;
  let admin: AdminOrderApi;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { useMocks: true, realAuth: true, realCommerce: true, apiBaseUrl: `${BASE}/`, siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true, realAuth: true, realCommerce: true }),
        provideAdminDataAccess({ useMocks: true, realCommerce: true }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    admin = TestBed.inject(AdminOrderApi);
  });
  afterEach(() => http.verify());

  it('lists orders with filters in the query string', async () => {
    const result = firstValueFrom(admin.list({ status: 'confirmed', page: 1, pageSize: 20 }));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/admin/orders`));
    expect(new URL(req.request.url).searchParams.get('status')).toBe('confirmed');
    req.flush({ items: [], total: 0, page: 1, pageSize: 20 });
    await result;
  });

  it('advances status and adds a note', async () => {
    const advanced = firstValueFrom(admin.advance('ORD-1', 'packed'));
    const advanceReq = http.expectOne(`${BASE}/admin/orders/ORD-1/status`);
    expect(advanceReq.request.method).toBe('PATCH');
    expect(advanceReq.request.body).toEqual({ status: 'packed' });
    advanceReq.flush({ id: 'ORD-1', status: 'packed', notes: [], allowedNext: ['shipped', 'cancelled'] });
    expect((await advanced).status).toBe('packed');

    const noted = firstValueFrom(admin.addNote('ORD-1', 'Called the customer.'));
    const noteReq = http.expectOne(`${BASE}/admin/orders/ORD-1/notes`);
    expect(noteReq.request.body).toEqual({ text: 'Called the customer.' });
    noteReq.flush({ id: 'ORD-1', notes: [{ id: 'n1', at: '2026-01-01', author: 'admin', text: 'Called the customer.' }] });
    expect((await noted).notes[0].text).toBe('Called the customer.');
  });
});
