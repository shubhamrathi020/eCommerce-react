import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG, AnalyticsService, AttributionService, ConsentService, PersonalisationService } from '@shop/core';
import type { Product, TrackedEvent } from '@ecom/contracts';
import { campaignReport, cleanTag, cohortTable, funnel, parseTouch, productPerformance, searchReport, sortPerformance, toCsv, touchKey, touchLabel } from '@ecom/contracts';
import {
  AdminAnalyticsApi,
  AuditApi,
  AuthApi,
  CartApi,
  DEMO_ACCOUNTS,
  MockEventStore,
  MockMailbox,
  MockOrderStore,
  OrderApi,
  loadCatalogData,
  provideAdminDataAccess,
  provideDataAccess,
} from '../index';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-07T10:00:00Z'); // a Wednesday
const ev = (name: string, vid: string, daysAgo: number, props: Record<string, string | number> = {}): TrackedEvent => ({ id: `e${Math.random()}`, at: new Date(NOW - daysAgo * DAY).toISOString(), vid, name, props });
const product = (id: string, title: string, stock: number, price = 10000): Product => ({ id, title, variants: [{ id: `${id}-v`, stock, price: { amount: price, currency: 'INR' } }] }) as unknown as Product;

describe('analytics (pure)', () => {
  it('builds the funnel from distinct visitors, with drop-off against the previous step', () => {
    const events = [
      ...['a', 'b', 'c', 'd'].map((v) => ev('product_view', v, 1)),
      ev('product_view', 'a', 2), // a second view by the same visitor still counts once
      ...['a', 'b'].map((v) => ev('add_to_cart', v, 1)),
      ev('checkout_start', 'a', 1),
      ev('payment_start', 'a', 1),
      ev('purchase', 'a', 1, { orderId: 'o1' }),
      ev('product_view', 'old', 40), // outside a 30-day window
    ];
    const f = funnel(events, NOW, 30);
    expect(f.map((s) => s.visitors)).toEqual([4, 2, 1, 1, 1]);
    expect(f.map((s) => s.dropOffPercent)).toEqual([null, 50, 50, 0, 0]);
    expect(f[4].ofFirstPercent).toBe(25);
    expect(funnel(events, NOW, 90)[0].visitors).toBe(5);
    expect(funnel([], NOW, 7).map((s) => s.visitors)).toEqual([0, 0, 0, 0, 0]);
  });

  it('computes views, add rate, units, revenue and sell-through per product, sortable', () => {
    const products = [product('p1', 'Alpha', 90), product('p2', 'Beta', 10, 5000)];
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ev('product_view', `v${i}`, 1, { productId: 'p1' })),
      ev('add_to_cart', 'v1', 1, { productId: 'p1', quantity: 2 }),
      ev('purchase', 'v1', 1, { productId: 'p1', quantity: 10, orderId: 'o1', unitPrice: 9000 }),
      ev('purchase', 'v2', 1, { productId: 'p2', quantity: 5, orderId: 'o2' }),
      ev('purchase', 'v2', 1, { productId: 'p2', quantity: 5, orderId: 'o3' }),
      ev('product_view', 'x', 1, { productId: 'ghost' }),
    ];
    const rows = productPerformance(events, products, NOW, 30);
    const p1 = rows.find((r) => r.productId === 'p1');
    expect(p1).toMatchObject({ views: 10, adds: 2, addRatePercent: 20, units: 10, orders: 1, revenue: 90000, stock: 90, sellThroughPercent: 10 });
    const p2 = rows.find((r) => r.productId === 'p2');
    expect(p2).toMatchObject({ units: 10, orders: 2, revenue: 50000, sellThroughPercent: 50 }); // price fallback when the event has none
    expect(rows.some((r) => r.productId === 'ghost')).toBe(false);
    expect(sortPerformance(rows, 'sellThroughPercent', 'desc').map((r) => r.productId)).toEqual(['p2', 'p1']);
    expect(sortPerformance(rows, 'title', 'asc').map((r) => r.title)).toEqual(['Alpha', 'Beta']);
    expect(sortPerformance(rows, 'views', 'asc')[0].productId).toBe('p2');
  });

  it('separates top searches from searches that never find anything, and measures click-through', () => {
    const events = [
      ev('search', 'a', 1, { term: 'Shirt ', results: 10 }),
      ev('search', 'b', 1, { term: 'shirt', results: 20 }),
      ev('search_result_click', 'a', 1, { term: 'shirt' }),
      ev('search_zero_results', 'c', 1, { term: 'kurta set', results: 0 }),
      ev('search_zero_results', 'd', 2, { term: 'KURTA  set', results: 0 }),
      ev('search', 'e', 99, { term: 'ancient', results: 1 }),
    ];
    const r = searchReport(events, NOW, 30);
    expect(r.top).toEqual([{ term: 'shirt', searches: 2, avgResults: 15, clicks: 1, clickThroughPercent: 50 }]);
    expect(r.zeroResults).toEqual([{ term: 'kurta set', searches: 2, avgResults: 0, clicks: 0, clickThroughPercent: 0 }]);
  });

  it('credits orders to the first and last campaign, and calls untagged orders direct', () => {
    const touchA = touchKey({ source: 'google', medium: 'cpc', campaign: 'sale' });
    const touchB = touchKey({ source: 'newsletter', medium: 'email' });
    const events = [
      ev('purchase', 'a', 1, { orderId: 'o1', quantity: 2, unitPrice: 1000, first_touch: touchA, last_touch: touchB }),
      ev('purchase', 'a', 1, { orderId: 'o1', quantity: 1, unitPrice: 500, first_touch: touchA, last_touch: touchB }), // second line of the same order
      ev('purchase', 'b', 1, { orderId: 'o2', quantity: 1, unitPrice: 700, first_touch: touchA, last_touch: touchA }),
      ev('purchase', 'c', 1, { orderId: 'o3', quantity: 1, unitPrice: 300 }),
    ];
    const rows = campaignReport(events, NOW, 30);
    expect(rows.find((r) => r.campaign === 'google / cpc / sale')).toMatchObject({ firstTouchOrders: 2, lastTouchOrders: 1, lastTouchRevenue: 700 });
    expect(rows.find((r) => r.campaign === 'newsletter / email')).toMatchObject({ firstTouchOrders: 0, lastTouchOrders: 1, lastTouchRevenue: 2500 });
    expect(rows.find((r) => r.campaign === 'direct')).toMatchObject({ firstTouchOrders: 1, lastTouchOrders: 1 });
    expect(parseTouch(touchA)).toEqual({ source: 'google', medium: 'cpc', campaign: 'sale' });
    expect(touchLabel({ source: 'x' })).toBe('x');
    expect(cleanTag('  <Script>alert(1)</Script> ')).toBe('scriptalert1script');
    expect(cleanTag('')).toBeUndefined();
  });

  it('shows weekly cohorts and how many buyers returned, leaving future weeks blank', () => {
    // NOW is Wednesday 7 Oct 2026, so this week started Monday 5 Oct.
    const events = [
      ev('purchase', 'a', 9, { orderId: 'o1' }), // week of 28 Sep
      ev('purchase', 'a', 2, { orderId: 'o2' }), // bought again the week of 5 Oct
      ev('purchase', 'b', 8, { orderId: 'o3' }), // week of 28 Sep, never returned
      ev('purchase', 'c', 1, { orderId: 'o4' }), // first order this week
    ];
    const table = cohortTable(events, NOW, 3);
    expect(table.map((r) => r.weekStart)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(table[0]).toMatchObject({ size: 0, retentionPercent: [0, 0, 0] });
    expect(table[1]).toMatchObject({ size: 2, retentionPercent: [100, 50, null] });
    expect(table[2]).toMatchObject({ size: 1, retentionPercent: [100, null, null] });
  });

  it('writes CSV that survives commas, quotes, line breaks and spreadsheet formulas', () => {
    const csv = toCsv(['Name', 'Note'], [['a,b', 'say "hi"'], ['=HYPERLINK("x")', 'line\nbreak'], ['+1', 5]]);
    expect(csv).toBe('Name,Note\r\n"a,b","say ""hi"""\r\n"\'=HYPERLINK(""x"")","line\nbreak"\r\n\'+1,5\r\n');
  });
});

describe('analytics (mock)', () => {
  const admin = DEMO_ACCOUNTS[1];
  const customer = DEMO_ACCOUNTS[0];
  let api: AdminAnalyticsApi;
  let auth: AuthApi;
  let mailbox: MockMailbox;
  let products: Product[];

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    api = TestBed.inject(AdminAnalyticsApi);
    auth = TestBed.inject(AuthApi);
    mailbox = TestBed.inject(MockMailbox);
    products = (await loadCatalogData()).products;
  });

  const signInAdmin = () => firstValueFrom(auth.login(admin.email, admin.password));

  it('is for staff only', async () => {
    await firstValueFrom(auth.login(customer.email, customer.password));
    for (const call of [() => api.funnel(30), () => api.products({ days: 30, sort: 'units', dir: 'desc', page: 1, pageSize: 10 }), () => api.search(30), () => api.campaigns(30), () => api.cohorts(), () => api.exportCsv('funnel', 30), () => api.schedules()]) {
      await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('reports the demo shop: a funnel that narrows, paginated sortable products, searches, campaigns and cohorts', async () => {
    await signInAdmin();
    const f = await firstValueFrom(api.funnel(30));
    expect(f[0].visitors).toBeGreaterThan(f[1].visitors);
    expect(f[1].visitors).toBeGreaterThan(f[4].visitors);
    expect(f[4].visitors).toBeGreaterThan(0);

    const page1 = await firstValueFrom(api.products({ days: 30, sort: 'units', dir: 'desc', page: 1, pageSize: 10 }));
    const page2 = await firstValueFrom(api.products({ days: 30, sort: 'units', dir: 'desc', page: 2, pageSize: 10 }));
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBeGreaterThan(20);
    expect(page1.items[0].units).toBeGreaterThanOrEqual(page1.items[9].units);
    expect(page1.items[9].units).toBeGreaterThanOrEqual(page2.items[0].units);
    const asc = await firstValueFrom(api.products({ days: 30, sort: 'views', dir: 'asc', page: 1, pageSize: 5 }));
    expect(asc.items[0].views).toBeLessThanOrEqual(asc.items[4].views);

    const s = await firstValueFrom(api.search(30));
    expect(s.top.length).toBeGreaterThan(3);
    expect(s.zeroResults.length).toBeGreaterThan(2);
    expect(s.zeroResults.every((r) => r.avgResults === 0)).toBe(true);

    const c = await firstValueFrom(api.campaigns(30));
    expect(c.length).toBeGreaterThan(2);
    expect(c.reduce((n, r) => n + r.lastTouchOrders, 0)).toBe(c.reduce((n, r) => n + r.firstTouchOrders, 0));

    const cohorts = await firstValueFrom(api.cohorts());
    expect(cohorts).toHaveLength(5);
    expect(cohorts.some((r) => r.size > 0)).toBe(true);
    for (const row of cohorts.filter((r) => r.size > 0)) expect(row.retentionPercent[0]).toBe(100);
  });

  it('only ever returns aggregates: no anonymous visitor ids appear in any report', async () => {
    await signInAdmin();
    const everything = JSON.stringify([
      await firstValueFrom(api.funnel(30)),
      await firstValueFrom(api.products({ days: 90, sort: 'views', dir: 'desc', page: 1, pageSize: 500 })),
      await firstValueFrom(api.search(90)),
      await firstValueFrom(api.campaigns(90)),
      await firstValueFrom(api.cohorts()),
    ]);
    expect(everything).not.toMatch(/v_seed|"vid"/);
  });

  it('exports every report as CSV, records the export in the audit log, and pages are limited to known periods', async () => {
    await signInAdmin();
    const funnelCsv = await firstValueFrom(api.exportCsv('funnel', 30));
    expect(funnelCsv.split('\r\n')[0]).toBe('Step,Visitors,Drop-off from previous step (%),Share of first step (%)');
    const productsCsv = await firstValueFrom(api.exportCsv('products', 30));
    const lines = productsCsv.trim().split('\r\n');
    expect(lines[0]).toContain('Sell-through (%)');
    expect(lines.length).toBeGreaterThan(50); // the whole report, not one page
    expect((await firstValueFrom(api.exportCsv('search', 30))).split('\r\n')[0]).toBe('List,Search term,Searches,Average results,Result clicks,Click-through (%)');
    expect((await firstValueFrom(api.exportCsv('campaigns', 30))).split('\r\n')[0]).toContain('Campaign');
    expect((await firstValueFrom(api.exportCsv('cohorts', 30))).split('\r\n')[0]).toContain('Week 0 (%)');
    await expect(firstValueFrom(api.exportCsv('nope' as never, 30))).rejects.toMatchObject({ code: 'validation' });
    const actions = (await firstValueFrom(TestBed.inject(AuditApi).list({ page: 1, pageSize: 10 }))).items.map((a) => a.action);
    expect(actions).toContain('analytics.export');
    // An unknown period falls back to 30 days rather than scanning everything.
    expect(await firstValueFrom(api.funnel(1234))).toEqual(await firstValueFrom(api.funnel(30)));
  });

  describe('scheduled reports (AN-06)', () => {
    it('validates a schedule, then delivers on demand to the mailbox with the report attached as CSV', async () => {
      await signInAdmin();
      await expect(firstValueFrom(api.createSchedule({ report: 'nope' as never, days: 12, frequency: 'monthly' as never, recipient: 'not-an-email' }))).rejects.toMatchObject({ fields: { report: expect.any(String), days: expect.any(String), frequency: expect.any(String), recipient: expect.any(String) } });
      const s = await firstValueFrom(api.createSchedule({ report: 'products', days: 7, frequency: 'weekly', recipient: 'owner@shop.test' }));
      expect(s).toMatchObject({ report: 'products', frequency: 'weekly', createdBy: admin.name });
      expect(Date.parse(s.nextRunAt)).toBeGreaterThan(Date.now() + 6 * DAY);
      expect(mailbox.list()).toHaveLength(0); // nothing arrives until it is due or sent

      const sent = await firstValueFrom(api.sendNow(s.id));
      expect(sent.lastRunAt).toBeDefined();
      const mail = mailbox.list()[0];
      expect(mail).toMatchObject({ to: 'owner@shop.test', subject: 'Scheduled report: Product performance (last 7 days)' });
      expect(mail.body).toContain('Product ID,Product,Views');
    });

    it('delivers a schedule that has come due when the list is opened, then moves it forward', async () => {
      await signInAdmin();
      const s = await firstValueFrom(api.createSchedule({ report: 'funnel', days: 30, frequency: 'daily', recipient: 'ops@shop.test' }));
      const stored = JSON.parse(localStorage.getItem('ecom.mock.report-schedules.v1') as string) as { nextRunAt: string }[];
      stored[0].nextRunAt = new Date(Date.now() - 1000).toISOString();
      localStorage.setItem('ecom.mock.report-schedules.v1', JSON.stringify(stored));

      const listed = await firstValueFrom(api.schedules());
      expect(mailbox.list().map((m) => m.to)).toEqual(['ops@shop.test']);
      expect(Date.parse(listed[0].nextRunAt)).toBeGreaterThan(Date.now() + DAY - 60_000);
      await firstValueFrom(api.schedules());
      expect(mailbox.list()).toHaveLength(1); // not sent twice

      await firstValueFrom(api.removeSchedule(s.id));
      await expect(firstValueFrom(api.removeSchedule(s.id))).rejects.toMatchObject({ code: 'not_found' });
      expect(await firstValueFrom(api.schedules())).toEqual([]);
    });
  });

  describe('campaign attribution (AN-05)', () => {
    let attribution: AttributionService;
    let consent: ConsentService;

    beforeEach(() => {
      attribution = TestBed.inject(AttributionService);
      consent = TestBed.inject(ConsentService);
    });

    it('remembers the first and last campaign only after consent, and cleans what it stores', () => {
      attribution.capture({ utm_source: 'google' });
      expect(attribution.touches()).toEqual({});
      consent.set('all');
      attribution.capture({ utm_source: 'Google', utm_medium: 'CPC', utm_campaign: 'Diwali Sale!<b>' });
      attribution.capture({ utm_source: 'newsletter' });
      attribution.capture({ foo: 'bar' });
      expect(attribution.touches()).toEqual({ first: { source: 'google', medium: 'cpc', campaign: 'diwalisaleb' }, last: { source: 'newsletter' } });
      TestBed.inject(PersonalisationService).setOptOut(true);
      attribution.capture({ utm_source: 'ignored' });
      expect(attribution.touches().last?.source).toBe('newsletter');
    });

    it('forgets touches older than 30 days', () => {
      consent.set('all');
      attribution.capture({ utm_source: 'google' });
      const stored = JSON.parse(localStorage.getItem('ecom.attribution.v1') as string);
      stored.first.at = new Date(Date.now() - 31 * DAY).toISOString();
      stored.last.at = stored.first.at;
      localStorage.setItem('ecom.attribution.v1', JSON.stringify(stored));
      expect(attribution.touches()).toEqual({});
    });

    it('tags the order and the funnel events with both touches', async () => {
      consent.set('all');
      attribution.capture({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'sale' });
      attribution.capture({ utm_source: 'instagram', utm_medium: 'social' });
      const analytics = TestBed.inject(AnalyticsService);
      analytics.track({ name: 'product_view', props: { productId: 'p-0001' } });
      analytics.track({ name: 'purchase', props: { productId: 'p-0001', quantity: 1, orderId: 'ORD-X' } });
      const [view, purchase] = TestBed.inject(MockEventStore).recorded();
      expect(view.props).toEqual({ productId: 'p-0001' }); // only funnel events carry a campaign
      expect(purchase.props).toMatchObject({ first_touch: 'google|cpc|sale', last_touch: 'instagram|social|none' });

      const variant = products[0].variants[0].id;
      await firstValueFrom(TestBed.inject(CartApi).add(variant, 1));
      const order = await firstValueFrom(TestBed.inject(OrderApi).place({ idempotencyKey: 'k-attr', contact: { name: 'A B', email: 'a@b.co', phone: '9876543210' }, address: { line1: '1 Rd', city: 'Pune', state: 'MH', pincode: '411001' }, paymentMethod: 'cod' }));
      expect(order.attribution).toEqual({ first: { source: 'google', medium: 'cpc', campaign: 'sale' }, last: { source: 'instagram', medium: 'social' } });
      expect(TestBed.inject(MockOrderStore).find(order.id)?.attribution).toEqual(order.attribution);
    });

    it('leaves orders untagged without consent', async () => {
      attribution.capture({ utm_source: 'google' });
      await firstValueFrom(TestBed.inject(CartApi).add(products[0].variants[0].id, 1));
      const order = await firstValueFrom(TestBed.inject(OrderApi).place({ idempotencyKey: 'k-none', contact: { name: 'A B', email: 'a@b.co', phone: '9876543210' }, address: { line1: '1 Rd', city: 'Pune', state: 'MH', pincode: '411001' }, paymentMethod: 'cod' }));
      expect(order.attribution).toBeUndefined();
    });
  });
});
