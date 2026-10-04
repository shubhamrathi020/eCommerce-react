import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG, AnalyticsService, ConsentService, PersonalisationService } from '@shop/core';
import type { Product, TrackedEvent } from '@ecom/contracts';
import { DEFAULT_REC_CONFIG, MIN_ROW_ITEMS, activityByProduct, applyRules, coPurchases, interestProfile, similarity } from '@ecom/contracts';
import { AdminRecommendationApi, AuditApi, AuthApi, DEMO_ACCOUNTS, MockEventStore, RecommendationApi, loadCatalogData, provideAdminDataAccess, provideDataAccess, seedEvents } from '../index';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-03T10:00:00Z');
const ev = (name: string, vid: string, productId: string, daysAgo = 0, extra: Record<string, string | number> = {}): TrackedEvent => ({ id: `e${Math.random()}`, at: new Date(NOW - daysAgo * DAY).toISOString(), vid, name, props: { productId, ...extra } });

describe('recommendation rules (pure)', () => {
  it('counts activity inside the window only, weighting carts and purchases above views', () => {
    const events = [ev('product_view', 'a', 'p1'), ev('product_view', 'b', 'p1'), ev('add_to_cart', 'a', 'p1', 1, { quantity: 2 }), ev('purchase', 'a', 'p1', 2, { quantity: 1, orderId: 'o1' }), ev('product_view', 'a', 'p1', 40), ev('search', 'a', 'p1')];
    const a = activityByProduct(events, NOW, 7).get('p1');
    expect(a).toEqual({ views: 2, adds: 2, units: 1, score: 2 + 6 + 5 });
    expect(activityByProduct(events, NOW, 90).get('p1')?.views).toBe(3);
  });

  it('finds products bought in the same order, not just bought by the same visitor', () => {
    const events = [
      ev('purchase', 'a', 'p1', 1, { orderId: 'o1' }),
      ev('purchase', 'a', 'p2', 1, { orderId: 'o1' }),
      ev('purchase', 'b', 'p1', 2, { orderId: 'o2' }),
      ev('purchase', 'b', 'p2', 2, { orderId: 'o2' }),
      ev('purchase', 'b', 'p3', 2, { orderId: 'o2' }),
      ev('purchase', 'a', 'p4', 3, { orderId: 'o3' }), // same visitor, different order
    ];
    expect([...coPurchases(events, 'p1')].sort()).toEqual([
      ['p2', 2],
      ['p3', 1],
    ]);
    expect(coPurchases(events, 'p4').size).toBe(0);
  });

  it('applies rules the same way every time: excluded never appear, boosts multiply, pins come first, ties are stable', () => {
    const scored = [
      { id: 'b', score: 5 },
      { id: 'a', score: 5 },
      { id: 'c', score: 9 },
      { id: 'd', score: 1 },
    ];
    expect(applyRules(scored, DEFAULT_REC_CONFIG)).toEqual(['c', 'a', 'b', 'd']);
    expect(applyRules([...scored].reverse(), DEFAULT_REC_CONFIG)).toEqual(['c', 'a', 'b', 'd']);
    expect(applyRules(scored, { ...DEFAULT_REC_CONFIG, excluded: ['c'] })).toEqual(['a', 'b', 'd']);
    expect(applyRules(scored, { ...DEFAULT_REC_CONFIG, boosts: { d: 10 } })[0]).toBe('d');
    expect(applyRules(scored, { ...DEFAULT_REC_CONFIG, pinned: ['d', 'zz'], excluded: ['zz'] }).slice(0, 2)).toEqual(['d', 'c']);
    expect(applyRules(scored, DEFAULT_REC_CONFIG, () => true, 2)).toHaveLength(2);
  });

  it('builds an interest profile that favours recent, deeper actions and remembers what was bought', async () => {
    const { products } = await loadCatalogData();
    const byId = new Map(products.map((p) => [p.id, p]));
    const [a, b] = [products[0], products.find((p) => p.categoryId !== products[0].categoryId) as Product];
    const events = [ev('product_view', 'v', a.id, 0), ev('product_view', 'v', b.id, 20), ev('purchase', 'v', a.id, 1, { quantity: 1 }), ev('product_view', 'other', b.id, 0)];
    const profile = interestProfile(events, 'v', byId, NOW);
    expect(profile.bought.has(a.id)).toBe(true);
    expect((profile.categories.get(a.categoryId) ?? 0)).toBeGreaterThan(profile.categories.get(b.categoryId) ?? 0);
    expect(profile.lastViewed).toBe(a.id);
    expect(interestProfile(events, 'nobody', byId, NOW).weight).toBe(0);
  });

  it('says why two products are similar, and never relates a product to itself', async () => {
    const { products } = await loadCatalogData();
    const a = products[0];
    expect(similarity(a, a).score).toBe(0);
    const peer = products.find((p) => p.id !== a.id && p.categoryId === a.categoryId) as Product;
    const s = similarity(a, peer);
    expect(s.score).toBeGreaterThan(3);
    expect(s.reason).toContain('Similar');
    const stranger = products.find((p) => p.categoryPath[0].id !== a.categoryPath[0].id) as Product;
    expect(similarity(a, stranger).score).toBe(0);
  });

  it('seeds deterministic demo behaviour, marked as seed data and free of personal details', async () => {
    const { products } = await loadCatalogData();
    const first = seedEvents(products, NOW);
    expect(first.length).toBeGreaterThan(1000);
    expect(seedEvents(products, NOW)).toBe(first);
    expect(first.every((e) => e.seed)).toBe(true);
    const keys = new Set(first.flatMap((e) => Object.keys(e.props ?? {})));
    expect([...keys].every((k) => ['productId', 'categoryId', 'quantity', 'orderId', 'term', 'results', 'unitPrice', 'first_touch', 'last_touch'].includes(k))).toBe(true);
    expect(JSON.stringify(first)).not.toContain('@');
  });
});

describe('recommendations and tracking (mock)', () => {
  let rec: RecommendationApi;
  let adminRec: AdminRecommendationApi;
  let auth: AuthApi;
  let analytics: AnalyticsService;
  let consent: ConsentService;
  let personalisation: PersonalisationService;
  let events: MockEventStore;
  let products: Product[];

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    rec = TestBed.inject(RecommendationApi);
    adminRec = TestBed.inject(AdminRecommendationApi);
    auth = TestBed.inject(AuthApi);
    analytics = TestBed.inject(AnalyticsService);
    consent = TestBed.inject(ConsentService);
    personalisation = TestBed.inject(PersonalisationService);
    events = TestBed.inject(MockEventStore);
    products = (await loadCatalogData()).products;
  });

  const signInAdmin = () => firstValueFrom(auth.login(DEMO_ACCOUNTS[1].email, DEMO_ACCOUNTS[1].password));
  const view = (p: Product) => analytics.track({ name: 'product_view', props: { productId: p.id, categoryId: p.categoryId } });
  const fillerIn = (category: string, n: number) => products.filter((p) => p.categoryId === category).slice(0, n);

  describe('tracking and privacy (RC-01, RC-06)', () => {
    it('records nothing until the shopper consents, then records anonymous events only', () => {
      view(products[0]);
      expect(events.recorded()).toEqual([]);
      consent.set('essential');
      view(products[0]);
      expect(events.recorded()).toEqual([]);
      consent.set('all');
      view(products[0]);
      const [e] = events.recorded();
      expect(e).toMatchObject({ name: 'product_view', vid: personalisation.visitorId(), props: { productId: products[0].id } });
      // The payload is an anonymous visitor id, a time, and product references: no account, name or email fields.
      expect(Object.keys(e).sort()).toEqual(['at', 'id', 'name', 'props', 'vid']);
      expect(e.vid).toMatch(/^v_/);
    });

    it('stops tracking when the shopper opts out, and resumes when they opt back in', () => {
      consent.set('all');
      personalisation.setOptOut(true);
      view(products[0]);
      expect(events.recorded()).toEqual([]);
      personalisation.setOptOut(false);
      view(products[0]);
      expect(events.recorded()).toHaveLength(1);
      expect(personalisation.optedOut()).toBe(false);
    });

    it('clears only this browser\'s history and gives it a new anonymous identity', async () => {
      consent.set('all');
      const before = personalisation.visitorId();
      view(products[0]);
      view(products[1]);
      events.add({ name: 'product_view', props: { productId: products[2].id }, vid: 'v_someone_else', at: new Date().toISOString() });
      expect(await firstValueFrom(rec.historyCount())).toBe(2);
      await firstValueFrom(rec.clearHistory());
      expect(await firstValueFrom(rec.historyCount())).toBe(0);
      expect(events.recorded().map((e) => e.vid)).toEqual(['v_someone_else']);
      expect(personalisation.visitorId()).not.toBe(before);
    });
  });

  describe('product page rows (RC-02)', () => {
    it('shows similar products without the current one, with a reason each, and bought-together from real baskets', async () => {
      // The product most often bought alongside another in the demo baskets.
      const demo = seedEvents(products, Date.now());
      const purchased = [...new Set(demo.filter((e) => e.name === 'purchase').map((e) => e.props?.['productId'] as string))];
      const best = purchased.map((id) => ({ id, top: Math.max(0, ...coPurchases(demo, id).values()) })).sort((a, b) => b.top - a.top || a.id.localeCompare(b.id))[0].id;
      const { similar, together } = await firstValueFrom(rec.forProduct(best));
      expect(similar).not.toBeNull();
      expect(similar?.items.length).toBeGreaterThanOrEqual(MIN_ROW_ITEMS);
      expect(similar?.items.some((i) => i.product.id === best)).toBe(false);
      expect(similar?.items.every((i) => i.reason.startsWith('Similar'))).toBe(true);
      expect(together).not.toBeNull();
      expect(together?.items.some((i) => i.product.id === best)).toBe(false);
      expect(together?.items.every((i) => /^Bought together in \d+ orders$/.test(i.reason))).toBe(true);
    });

    it('hides a row when the data is thin instead of showing a few weak items', async () => {
      const cold = products.find((p) => !activityByProduct(seedEvents(products, Date.now()), Date.now(), 90).has(p.id)) ?? products[products.length - 1];
      const rows = await firstValueFrom(rec.forProduct(cold.id));
      expect(rows.together).toBeNull(); // nobody bought it with anything
      expect(await firstValueFrom(rec.forProduct('p-missing'))).toEqual({ similar: null, together: null });
    });
  });

  describe('home rows (RC-03, RC-04)', () => {
    it('trending and best sellers come from tracked events, not a fixed list', async () => {
      const home = await firstValueFrom(rec.home());
      expect(home.trending?.items.length).toBeGreaterThanOrEqual(MIN_ROW_ITEMS);
      expect(home.trending?.items[0].reason).toMatch(/views and \d+ adds this week/);
      expect(home.bestSellers?.items[0].reason).toMatch(/\d+ sold this month/);

      // Push an unremarkable in-stock product to the top with real events and watch it move.
      consent.set('all');
      const target = products.find((p) => p.id === 'p-0100') as Product;
      for (let i = 0; i < 400; i++) events.add({ name: 'product_view', props: { productId: target.id }, vid: `v_crowd_${i}`, at: new Date().toISOString() });
      const after = await firstValueFrom(rec.home());
      expect(after.trending?.items[0].product.id).toBe(target.id);
    });

    it('gives a new visitor popular items and says it is a cold start', async () => {
      const { personalised } = await firstValueFrom(rec.home());
      expect(personalised).toMatchObject({ title: 'Popular right now', coldStart: true });
      expect(personalised?.items.length).toBeGreaterThanOrEqual(MIN_ROW_ITEMS);
    });

    it('personalises from the visitor\'s own activity, then falls back when they opt out', async () => {
      consent.set('all');
      const kitchen = fillerIn('cat-cookware', 8);
      expect(kitchen.length).toBeGreaterThanOrEqual(6);
      for (const p of kitchen.slice(0, 3)) {
        view(p);
        analytics.track({ name: 'add_to_cart', props: { productId: p.id, quantity: 1 } });
      }
      const mine = (await firstValueFrom(rec.home())).personalised;
      expect(mine).toMatchObject({ title: 'Recommended for you' });
      expect(mine?.coldStart).toBeUndefined();
      expect(mine?.items[0].reason).toContain('Because you looked at');
      expect(mine?.items.slice(0, 3).every((i) => products.find((p) => p.id === i.product.id)?.categoryId === 'cat-cookware')).toBe(true);

      personalisation.setOptOut(true);
      const off = (await firstValueFrom(rec.home())).personalised;
      expect(off).toMatchObject({ title: 'Popular right now', coldStart: true });
      expect(off?.subtitle).toContain('Personalisation is off');
    });

    it('does not recommend what the visitor has already bought', async () => {
      consent.set('all');
      const kitchen = fillerIn('cat-cookware', 8);
      view(kitchen[0]);
      analytics.track({ name: 'purchase', props: { productId: kitchen[0].id, quantity: 1, orderId: 'ORD-X' } });
      const row = (await firstValueFrom(rec.home())).personalised;
      expect(row?.items.some((i) => i.product.id === kitchen[0].id)).toBe(false);
    });
  });

  describe('admin controls (RC-05)', () => {
    it('keeps the controls away from customers', async () => {
      await firstValueFrom(auth.login(DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].password));
      for (const call of [() => adminRec.config(), () => adminRec.stats(), () => adminRec.preview()]) await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('takes effect immediately: exclude, pin, boost and switch a strategy off', async () => {
      const first = await firstValueFrom(rec.home());
      const top = first.trending?.items[0].product.id as string;
      const second = first.trending?.items[1].product.id as string;
      const lowest = first.trending?.items[first.trending.items.length - 1].product.id as string;
      await signInAdmin();
      const base = await firstValueFrom(adminRec.config());

      await firstValueFrom(adminRec.saveConfig({ ...base, excluded: [top] }));
      expect((await firstValueFrom(rec.home())).trending?.items.some((i) => i.product.id === top)).toBe(false);

      await firstValueFrom(adminRec.saveConfig({ ...base, excluded: [], pinned: [lowest] }));
      expect((await firstValueFrom(rec.home())).trending?.items[0].product.id).toBe(lowest);

      await firstValueFrom(adminRec.saveConfig({ ...base, pinned: [], boosts: { [lowest]: 10 } }));
      const boosted = (await firstValueFrom(rec.home())).trending?.items.map((i) => i.product.id) as string[];
      expect(boosted.indexOf(lowest)).toBeLessThan(first.trending?.items.map((i) => i.product.id).indexOf(lowest) as number);

      await firstValueFrom(adminRec.saveConfig({ ...base, strategies: { ...base.strategies, trending: false, similar: false } }));
      expect((await firstValueFrom(rec.home())).trending).toBeNull();
      expect((await firstValueFrom(rec.forProduct(second))).similar).toBeNull();

      const audit = (await firstValueFrom(TestBed.inject(AuditApi).list({ page: 1, pageSize: 10 }))).items.map((a) => a.action);
      expect(audit).toContain('recommendations.config');
    });

    it('validates the rules', async () => {
      await signInAdmin();
      const base = await firstValueFrom(adminRec.config());
      await expect(firstValueFrom(adminRec.saveConfig({ ...base, pinned: ['p-0001', 'nope'] }))).rejects.toMatchObject({ fields: { pinned: expect.stringContaining('nope') } });
      await expect(firstValueFrom(adminRec.saveConfig({ ...base, boosts: { 'p-0001': 50 } }))).rejects.toMatchObject({ fields: { boosts: expect.any(String) } });
      await expect(firstValueFrom(adminRec.saveConfig({ ...base, pinned: ['p-0001'], excluded: ['p-0001'] }))).rejects.toMatchObject({ fields: { pinned: expect.stringContaining('both') } });
      await expect(firstValueFrom(adminRec.saveConfig({ ...base, minTogether: 0 }))).rejects.toMatchObject({ fields: { minTogether: expect.any(String) } });
    });

    it('previews the home rows for a new visitor, or a product\'s rows, with event numbers', async () => {
      await signInAdmin();
      const home = await firstValueFrom(adminRec.preview());
      expect(home.rows.map((r) => r.strategy)).toEqual(expect.arrayContaining(['personalised', 'trending', 'best_sellers']));
      expect(home.stats.events).toBeGreaterThan(1000);
      const product = await firstValueFrom(adminRec.preview('p-0001'));
      expect(product.rows.every((r) => r.items.every((i) => i.product.id !== 'p-0001'))).toBe(true);
    });
  });
});
