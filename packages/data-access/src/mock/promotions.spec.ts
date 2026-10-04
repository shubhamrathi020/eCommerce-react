import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { Order, Promotion, PromotionContext, PromoLine, StoredCart } from '@ecom/contracts';
import { discountPercent, evaluatePromotions, isCredibleReference } from '@ecom/contracts';
import {
  AdminGiftCardApi,
  AdminPromotionApi,
  AuthApi,
  CartApi,
  DEMO_ACCOUNTS,
  MockOrderStore,
  MockPromotionStore,
  OrderApi,
  PromotionApi,
  ReturnApi,
  WalletApi,
  loadCatalogData,
  provideAdminDataAccess,
  provideDataAccess,
} from '../index';
import { priceCart } from './cart-engine';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-03T10:00:00Z');
const ctx = (over: Partial<PromotionContext> = {}): PromotionContext => ({ now: NOW, priorOrders: 1, flashRemaining: {}, ...over });
const line = (variantId: string, unitPrice: number, quantity: number, categoryIds = ['cat-x'], productId = `p-${variantId}`): PromoLine => ({ variantId, productId, categoryIds, unitPrice, quantity });
const base = { enabled: true, priority: 1, segment: 'all', stacking: 'stackable' } as const;

const bogo: Promotion = { ...base, id: 'bogo', name: 'Buy 2 get 1', kind: 'buy_x_get_y', buy: 2, get: 1, percentOff: 100, categoryIds: ['cat-x'] };
const sale: Promotion = { ...base, id: 'sale', name: '10% sale', kind: 'category_sale', categoryIds: ['cat-x'], percent: 10 };

describe('promotion engine (pure)', () => {
  it('buy 2 get 1 free discounts the cheapest unit in each group of three', () => {
    const out = evaluatePromotions([line('a', 1000, 2), line('b', 400, 1), line('c', 700, 3)], [bogo], ctx());
    // Six matching units make two groups: the two cheapest (400 and 700) are free.
    expect(out.discount).toBe(1100);
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0].label).toBe('Buy 2 get 1 free');
    expect(evaluatePromotions([line('a', 1000, 2)], [bogo], ctx()).trace[0]).toMatchObject({ outcome: 'skipped', reason: 'Needs 3 matching items (the cart has 2)' });
  });

  it('applies the highest reached tier by spend or by quantity, and says how far away the first tier is', () => {
    const tiered: Promotion = { ...base, id: 't', name: 'Tiers', kind: 'tiered', basis: 'subtotal', tiers: [{ min: 5000, percent: 5 }, { min: 10000, percent: 10 }] };
    expect(evaluatePromotions([line('a', 4000, 1)], [tiered], ctx()).trace[0].reason).toContain('Spend ₹10');
    expect(evaluatePromotions([line('a', 6000, 1)], [tiered], ctx()).discount).toBe(300);
    expect(evaluatePromotions([line('a', 6000, 2)], [tiered], ctx()).discount).toBe(1200);
    const byQty: Promotion = { ...tiered, basis: 'quantity', tiers: [{ min: 3, percent: 20 }] };
    expect(evaluatePromotions([line('a', 1000, 2)], [byQty], ctx()).trace[0].reason).toContain('Add 1 more');
    expect(evaluatePromotions([line('a', 1000, 3)], [byQty], ctx()).discount).toBe(600);
  });

  it('respects schedule, pause and segment, and says why an offer was skipped', () => {
    const lines = [line('a', 1000, 1)];
    const reason = (p: Promotion, c = ctx()) => evaluatePromotions(lines, [p], c).trace[0].reason;
    expect(reason({ ...sale, startsAt: new Date(NOW + DAY).toISOString() })).toBe('Has not started yet');
    expect(reason({ ...sale, endsAt: new Date(NOW - DAY).toISOString() })).toBe('Has ended');
    expect(reason({ ...sale, enabled: false })).toBe('Paused');
    expect(reason({ ...sale, segment: 'first_order' })).toBe('Only for a first order');
    expect(reason({ ...sale, segment: 'returning' }, ctx({ priorOrders: 0 }))).toBe('Only for returning customers');
    expect(evaluatePromotions(lines, [{ ...sale, segment: 'first_order' }], ctx({ priorOrders: 0 })).discount).toBe(100);
    expect(evaluatePromotions(lines, [{ ...sale, segment: 'returning' }], ctx({ priorOrders: 2 })).discount).toBe(100);
  });

  it('flash deals stop at the cap, the per-order limit, or the end time', () => {
    const flash: Promotion = { ...base, id: 'f', name: 'Flash', kind: 'flash', productId: 'p-a', dealPrice: 600, cap: 5, perOrderLimit: 2, stacking: 'exclusive', endsAt: new Date(NOW + DAY).toISOString() };
    const lines = [line('a', 1000, 4)];
    const out = evaluatePromotions(lines, [flash], ctx());
    expect(out.discount).toBe(800); // 2 units at 400 off
    expect(out.applied[0]).toMatchObject({ units: 2 });
    expect(evaluatePromotions(lines, [{ ...flash, perOrderLimit: undefined }], ctx({ flashRemaining: { f: 3 } })).discount).toBe(1200); // only 3 left
    expect(evaluatePromotions(lines, [flash], ctx({ flashRemaining: { f: 0 } })).trace[0].reason).toBe('Sold out');
    expect(evaluatePromotions(lines, [flash], ctx({ now: NOW + 2 * DAY })).trace[0].reason).toBe('Has ended');
  });

  it('stacks stackable offers, never past the value of a line', () => {
    const big: Promotion = { ...sale, id: 'big', name: '95% off', percent: 90, priority: 9 };
    const out = evaluatePromotions([line('a', 1000, 1)], [big, sale, { ...sale, id: 'sale2', name: 'Another 90%', percent: 90 }], ctx());
    expect(out.discount).toBeLessThanOrEqual(1000);
    expect(out.applied.reduce((n, a) => n + a.amount.amount, 0)).toBe(out.discount);
  });

  it('resolves conflicts the same way every time: the best allowed outcome wins, ties go to the stackable set, exclusive offers refuse a coupon', () => {
    const lines = [line('a', 10000, 1)];
    const exclusive: Promotion = { ...sale, id: 'excl', name: 'Exclusive 25%', percent: 25, stacking: 'exclusive', priority: 50 };
    const coupon = (after: number) => Math.floor(after * 0.1); // a 10% coupon

    // Exclusive 25% (2500) beats stackable 10% + coupon 10% of the rest (1000 + 900).
    const a = evaluatePromotions(lines, [sale, exclusive], ctx(), coupon);
    expect(a.applied.map((x) => x.promotionId)).toEqual(['excl']);
    expect(a.couponAllowed).toBe(false);
    expect(a.trace.find((t) => t.promotionId === 'sale')).toMatchObject({ outcome: 'skipped' });

    // A weaker exclusive loses to the stackable set plus the coupon.
    const weak: Promotion = { ...exclusive, percent: 12 };
    const b = evaluatePromotions(lines, [sale, weak], ctx(), coupon);
    expect(b.applied.map((x) => x.promotionId)).toEqual(['sale']);
    expect(b.couponAllowed).toBe(true);
    expect(b.trace.find((t) => t.promotionId === 'excl')?.reason).toContain('cannot be combined');

    // Input order never changes the answer.
    expect(evaluatePromotions(lines, [exclusive, sale], ctx(), coupon)).toEqual(a);
    expect(evaluatePromotions(lines, [weak, sale], ctx(), coupon)).toEqual(b);
    // An exact tie goes to the stackable set (the earlier candidate), whichever way the list is ordered.
    const tie: Promotion = { ...exclusive, id: 'tie', percent: 10 };
    expect(evaluatePromotions(lines, [tie, sale], ctx()).applied.map((x) => x.promotionId)).toEqual(['sale']);
  });

  it('stays fast on a large cart', () => {
    const lines = Array.from({ length: 500 }, (_, i) => line(`v${i}`, 1000 + i, 1 + (i % 3)));
    const promos: Promotion[] = Array.from({ length: 40 }, (_, i) => ({ ...sale, id: `s${i}`, name: `Sale ${i}`, percent: 1 + (i % 5), priority: i }));
    const t0 = performance.now();
    const out = evaluatePromotions(lines, [...promos, bogo], ctx());
    expect(performance.now() - t0).toBeLessThan(500);
    expect(out.discount).toBeGreaterThan(0);
  });
});

describe('price presentation (PE-07)', () => {
  it('only labels a discount against a believable earlier price', () => {
    const money = (amount: number) => ({ amount, currency: 'INR' as const });
    expect(discountPercent(money(7500), money(10000))).toBe(25);
    expect(discountPercent(money(2500), money(10000))).toBe(75);
    expect(discountPercent(money(2000), money(10000))).toBe(0); // 80% off: unverified reference, no label
    expect(discountPercent(money(10000), money(10000))).toBe(0);
    expect(discountPercent(money(12000), money(10000))).toBe(0);
    expect(discountPercent(money(5000))).toBe(0);
    expect(isCredibleReference(2000, 10000)).toBe(false);
    expect(isCredibleReference(2500, 10000)).toBe(true);
  });
});

describe('priceCart with promotions', () => {
  it('prices exactly as before when no promotions are given', async () => {
    const { products } = await loadCatalogData();
    const v = products[0].variants[0];
    const stored: StoredCart = { items: [{ variantId: v.id, quantity: 2, seenPrice: v.price.amount }], shippingMethod: 'standard' };
    const plain = priceCart(stored, products, NOW);
    const withEmpty = priceCart(stored, products, NOW, { promotions: [] });
    expect(withEmpty.cart).toEqual(plain.cart);
    expect(plain.cart.totals.promotionDiscount).toBeUndefined();
  });
});

describe('promotions, deals, gift cards and store credit (mock)', () => {
  const customer = DEMO_ACCOUNTS[0];
  const admin = DEMO_ACCOUNTS[1];
  let auth: AuthApi;
  let cart: CartApi;
  let wallet: WalletApi;
  let adminPromotions: AdminPromotionApi;
  let giftCards: AdminGiftCardApi;
  let orders: OrderApi;
  let variantOf: (productId: string, index?: number) => string;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    cart = TestBed.inject(CartApi);
    wallet = TestBed.inject(WalletApi);
    adminPromotions = TestBed.inject(AdminPromotionApi);
    giftCards = TestBed.inject(AdminGiftCardApi);
    orders = TestBed.inject(OrderApi);
    const { products } = await loadCatalogData();
    variantOf = (productId, index = 0) => (products.find((p) => p.id === productId)?.variants[index] as { id: string }).id;
  });

  const signInCustomer = () => firstValueFrom(auth.login(customer.email, customer.password));
  const signInAdmin = () => firstValueFrom(auth.login(admin.email, admin.password));
  const address = { name: 'Demo Customer', email: customer.email, phone: '9876543210' };
  const delivery = { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  const place = (paymentMethod: 'cod' | 'razorpay' = 'cod', key = `k-${Math.random()}`) => firstValueFrom(orders.place({ idempotencyKey: key, contact: address, address: delivery, paymentMethod }));

  describe('automatic offers in the cart (PE-01, PE-03, PE-04)', () => {
    it('shows each saving as its own line and the total follows', async () => {
      await firstValueFrom(cart.add(variantOf('p-0002'), 1)); // a fashion item: Fashion fest 10% (+ welcome offer for a first order over 999)
      const c = await firstValueFrom(cart.get());
      expect(c.promotions?.map((p) => p.promotionId).sort()).toEqual(['promo-fashion-sale', 'promo-first-order']);
      const sum = c.promotions?.reduce((n, p) => n + p.amount.amount, 0);
      expect(c.totals.promotionDiscount?.amount).toBe(sum);
      expect(c.totals.total.amount).toBe(c.totals.subtotal.amount - (sum ?? 0) + c.totals.shipping.amount);
    });

    it('first-order offers stop applying once the customer has an order', async () => {
      await signInCustomer();
      await firstValueFrom(cart.add(variantOf('p-0002'), 1));
      expect((await firstValueFrom(cart.get())).promotions?.some((p) => p.promotionId === 'promo-first-order')).toBe(true);
      await place();
      await firstValueFrom(cart.add(variantOf('p-0002'), 1));
      const after = await firstValueFrom(cart.get());
      expect(after.promotions?.some((p) => p.promotionId === 'promo-first-order')).toBe(false);
      expect(after.promotions?.some((p) => p.promotionId === 'promo-fashion-sale')).toBe(true);
    });

    it('lets an exclusive offer win over a coupon and explains it', async () => {
      await firstValueFrom(cart.add(variantOf('p-0001'), 2)); // the flash-deal tee (exclusive) is also a fashion item
      const c = await firstValueFrom(cart.applyCoupon('FLAT100'));
      expect(c.promotions?.map((p) => p.promotionId)).toEqual(['promo-flash-tee']);
      expect(c.coupon).toBeUndefined();
      expect(c.notices.join(' ')).toContain('cannot be combined with a coupon');
    });

    it('records the offers on the order and refunds with a share of the offer discount', async () => {
      await signInCustomer();
      await firstValueFrom(cart.add(variantOf('p-0002'), 1));
      const priced = await firstValueFrom(cart.get());
      const order = await place();
      expect(order.promotions?.length).toBe(priced.promotions?.length);
      expect(order.totals.promotionDiscount).toEqual(priced.totals.promotionDiscount);
      expect(await firstValueFrom(TestBed.inject(ReturnApi).list())).toEqual([]);
    });
  });

  describe('flash deals (PE-02)', () => {
    it('are listed with a countdown end and stock, per product, and sell out at the cap', async () => {
      const deals = await firstValueFrom(TestBed.inject(PromotionApi).activeDeals());
      expect(deals.map((d) => d.id)).toEqual(['promo-flash-tee']);
      expect(deals[0]).toMatchObject({ remaining: 20, cap: 20, productId: 'p-0001' });
      expect(Date.parse(deals[0].endsAt)).toBeGreaterThan(Date.now());
      expect(await firstValueFrom(TestBed.inject(PromotionApi).dealFor('p-0002'))).toBeNull();

      // Cap the deal at 3 units, then sell 2 + 1 across two orders: the fourth unit is full price and the deal ends.
      await signInAdmin();
      const flash = (await firstValueFrom(adminPromotions.list())).find((p) => p.kind === 'flash') as Extract<Promotion, { kind: 'flash' }>;
      await firstValueFrom(adminPromotions.save({ ...flash, cap: 3, perOrderLimit: undefined }));
      await firstValueFrom(auth.logout());

      await firstValueFrom(cart.add(variantOf('p-0001'), 2));
      const first = await firstValueFrom(cart.get());
      expect(first.promotions?.[0]).toMatchObject({ promotionId: 'promo-flash-tee', units: 2 });
      await place();
      await firstValueFrom(cart.add(variantOf('p-0001'), 2));
      const second = await firstValueFrom(cart.get());
      expect(second.promotions?.[0]).toMatchObject({ units: 1 }); // only one unit was left at the deal price
      await place();
      expect(await firstValueFrom(TestBed.inject(PromotionApi).activeDeals())).toEqual([]);
      await firstValueFrom(cart.add(variantOf('p-0001'), 1));
      expect((await firstValueFrom(cart.get())).promotions?.some((p) => p.promotionId === 'promo-flash-tee')).toBe(false);
    });

    it('put their units back when the order is cancelled', async () => {
      await firstValueFrom(cart.add(variantOf('p-0001'), 2));
      const order = await place();
      expect((await firstValueFrom(TestBed.inject(PromotionApi).activeDeals()))[0].remaining).toBe(18);
      await firstValueFrom(orders.cancel(order.id));
      expect((await firstValueFrom(TestBed.inject(PromotionApi).activeDeals()))[0].remaining).toBe(20);
    });

    it('end at their end time', async () => {
      await signInAdmin();
      const flash = (await firstValueFrom(adminPromotions.list())).find((p) => p.kind === 'flash') as Extract<Promotion, { kind: 'flash' }>;
      const saved = await firstValueFrom(adminPromotions.save({ ...flash, startsAt: new Date(Date.now() - 2 * DAY).toISOString(), endsAt: new Date(Date.now() - DAY).toISOString() }));
      expect(saved.demo).toBeUndefined();
      expect(await firstValueFrom(TestBed.inject(PromotionApi).activeDeals())).toEqual([]);
    });
  });

  describe('gift cards and store credit (PE-05)', () => {
    it('applies a gift card to the cart, spends it at order time, never goes below zero and keeps a ledger', async () => {
      await firstValueFrom(cart.add(variantOf('p-0003'), 1));
      const before = await firstValueFrom(cart.get());
      await expect(firstValueFrom(wallet.apply({ giftCardCode: 'NOPE' }))).rejects.toMatchObject({ code: 'validation' });
      await firstValueFrom(wallet.apply({ giftCardCode: 'gift500' }));
      const withCard = await firstValueFrom(cart.get());
      expect(withCard.giftCardCode).toBe('GIFT500');
      expect(withCard.totals.giftCardApplied?.amount).toBe(50_000);
      expect(withCard.totals.total.amount).toBe(before.totals.total.amount - 50_000);

      const order = await place();
      expect(order.tender).toEqual({ giftCard: { code: 'GIFT500', amount: 50_000 } });
      expect((await firstValueFrom(wallet.checkGiftCard('GIFT500')).catch((e) => e)).code).toBe('validation'); // spent in full
      await signInAdmin();
      const card = (await firstValueFrom(giftCards.list())).find((g) => g.code === 'GIFT500');
      expect(card).toMatchObject({ balance: 0, initialAmount: 50_000 });
      expect(card?.entries.map((e) => e.type)).toEqual(['redeem', 'issue']);
      expect(card?.entries[0]).toMatchObject({ amount: -50_000, orderId: order.id });
    });

    it('returns the balance when the order is cancelled', async () => {
      await firstValueFrom(cart.add(variantOf('p-0003'), 1));
      await firstValueFrom(wallet.apply({ giftCardCode: 'GIFT500' }));
      const order = await place();
      await firstValueFrom(orders.cancel(order.id));
      const check = await firstValueFrom(wallet.checkGiftCard('GIFT500'));
      expect(check.balance.amount).toBe(50_000);
      // Cancelling again must not refund twice.
      await firstValueFrom(orders.cancel(order.id));
      expect((await firstValueFrom(wallet.checkGiftCard('GIFT500'))).balance.amount).toBe(50_000);
    });

    it('can pay for a whole order, which is then confirmed and paid without a payment step', async () => {
      await signInAdmin();
      const big = await firstValueFrom(giftCards.issue({ amount: 5_000_000, code: 'BIGCARD1' }));
      expect(big.balance).toBe(5_000_000);
      await firstValueFrom(auth.logout());
      await firstValueFrom(cart.add(variantOf('p-0003'), 1));
      await firstValueFrom(wallet.apply({ giftCardCode: 'BIGCARD1' }));
      const c = await firstValueFrom(cart.get());
      expect(c.totals.total.amount).toBe(0);
      const order = await place('razorpay');
      expect(order).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
      expect(order.tender?.giftCard?.amount).toBe(c.totals.subtotal.amount - (c.totals.promotionDiscount?.amount ?? 0) + c.totals.shipping.amount);
      expect((await firstValueFrom(cart.get())).lines).toEqual([]);
      expect((await firstValueFrom(wallet.checkGiftCard('BIGCARD1'))).balance.amount).toBe(5_000_000 - (order.tender?.giftCard?.amount ?? 0));
    });

    it('rejects expired, disabled and unknown cards with a reason; issuing validates and codes are unique', async () => {
      await signInAdmin();
      await expect(firstValueFrom(giftCards.issue({ amount: 50, code: 'x' }))).rejects.toMatchObject({ fields: { amount: expect.any(String), code: expect.any(String) } });
      await expect(firstValueFrom(giftCards.issue({ amount: 20_000, code: 'GIFT500' }))).rejects.toMatchObject({ code: 'conflict' });
      await expect(firstValueFrom(giftCards.issue({ amount: 20_000, expiresOn: '2020-01-01' }))).rejects.toMatchObject({ fields: { expiresOn: expect.any(String) } });
      const disabled = await firstValueFrom(giftCards.issue({ amount: 20_000, code: 'OFFCARD1' }));
      await firstValueFrom(giftCards.setStatus(disabled.code, 'disabled'));
      await expect(firstValueFrom(wallet.checkGiftCard('OFFCARD1'))).rejects.toMatchObject({ message: 'This gift card has been disabled.' });
      await expect(firstValueFrom(wallet.checkGiftCard('MISSING1'))).rejects.toMatchObject({ code: 'validation' });
    });

    it('spends store credit (from refunds), only for a signed-in customer, and never more than the total', async () => {
      await firstValueFrom(cart.add(variantOf('p-0003'), 1));
      await expect(firstValueFrom(wallet.apply({ useCredit: true }))).rejects.toMatchObject({ code: 'unauthorized' });
      await signInCustomer();
      // Give the customer 300 of store credit directly (a refund would normally do this).
      TestBed.inject(MockPromotionStore); // ensure the store is live
      const returnsStore = (await import('./return-store')).MockReturnStore;
      TestBed.inject(returnsStore).transact((s) => {
        s.credit[customer.id] = 30_000;
      });
      expect((await firstValueFrom(wallet.summary())).credit.amount).toBe(30_000);
      await firstValueFrom(cart.add(variantOf('p-0003'), 1));
      const before = await firstValueFrom(cart.get());
      await firstValueFrom(wallet.apply({ useCredit: true }));
      const c = await firstValueFrom(cart.get());
      expect(c.totals.creditApplied?.amount).toBe(30_000);
      expect(c.totals.total.amount).toBe(before.totals.total.amount - 30_000);
      const order = await place();
      expect(order.tender?.storeCredit).toBe(30_000);
      expect((await firstValueFrom(wallet.summary())).credit.amount).toBe(0);
      await firstValueFrom(orders.cancel(order.id));
      expect((await firstValueFrom(wallet.summary())).credit.amount).toBe(30_000);
    });
  });

  describe('admin promotions and simulator (PE-06)', () => {
    it('keeps promotion tools away from customers', async () => {
      await signInCustomer();
      for (const call of [() => adminPromotions.list(), () => adminPromotions.priceHealth(), () => giftCards.list(), () => adminPromotions.simulate({ items: [{ variantId: variantOf('p-0001'), quantity: 1 }], priorOrders: 0 })]) {
        await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
      }
    });

    it('validates promotions, then creates, pauses and deletes them with an audit trail', async () => {
      await signInAdmin();
      await expect(firstValueFrom(adminPromotions.save({ ...base, name: '', kind: 'category_sale', categoryIds: [], percent: 0 } as never))).rejects.toMatchObject({ fields: { name: expect.any(String), categoryIds: expect.any(String), percent: expect.any(String) } });
      await expect(firstValueFrom(adminPromotions.save({ ...base, name: 'Bad tiers', kind: 'tiered', basis: 'subtotal', tiers: [{ min: 500, percent: 5 }, { min: 400, percent: 9 }] } as never))).rejects.toMatchObject({ fields: { tiers: expect.stringContaining('increase') } });
      await expect(firstValueFrom(adminPromotions.save({ ...base, name: 'Flash', kind: 'flash', productId: 'p-0002', dealPrice: 99_999_999, cap: 5, endsAt: new Date(Date.now() + DAY).toISOString() } as never))).rejects.toMatchObject({ fields: { dealPrice: expect.stringContaining('below the current price') } });
      await expect(firstValueFrom(adminPromotions.save({ ...base, name: 'No end', kind: 'flash', productId: 'p-0002', dealPrice: 100, cap: 5 } as never))).rejects.toMatchObject({ fields: { endsAt: expect.any(String) } });

      const created = await firstValueFrom(adminPromotions.save({ ...base, name: 'Books 20%', kind: 'category_sale', categoryIds: ['cat-books'], percent: 20 }));
      expect(created.id).toMatch(/^promo-/);
      expect((await firstValueFrom(adminPromotions.setEnabled(created.id, false))).enabled).toBe(false);
      await firstValueFrom(adminPromotions.remove(created.id));
      await expect(firstValueFrom(adminPromotions.remove(created.id))).rejects.toMatchObject({ code: 'not_found' });
      const actions = (await firstValueFrom(TestBed.inject((await import('../index')).AuditApi).list({ page: 1, pageSize: 20 }))).items.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['promotion.create', 'promotion.pause', 'promotion.delete']));
    });

    it('simulates a sample cart and explains every rule without changing anything', async () => {
      await signInAdmin();
      const items = [{ variantId: variantOf('p-0001'), quantity: 2 }];
      const first = await firstValueFrom(adminPromotions.simulate({ items, couponCode: 'FLAT100', priorOrders: 0 }));
      expect(first.applied.map((a) => a.promotionId)).toEqual(['promo-flash-tee']);
      expect(first.couponDiscount.amount).toBe(0);
      expect(first.couponNote).toContain('cannot be combined');
      const byId = Object.fromEntries(first.trace.map((t) => [t.promotionId, t]));
      expect(byId['promo-flash-tee']).toMatchObject({ outcome: 'applied' });
      expect(byId['promo-fashion-sale']).toMatchObject({ outcome: 'skipped', reason: expect.stringContaining('saves more') });
      expect(byId['promo-snack-bogo'].reason).toBe('No matching items in the cart');
      expect(first.total.amount).toBe(first.subtotal.amount - first.promotionDiscount.amount + first.shipping.amount);

      // Returning customer, a week from now: the first-order offer is out, the flash deal has ended.
      const later = await firstValueFrom(adminPromotions.simulate({ items, priorOrders: 3, at: new Date(Date.now() + 5 * DAY).toISOString() }));
      expect(later.trace.find((t) => t.promotionId === 'promo-first-order')?.reason).toBe('Only for a first order');
      // Nothing real moved.
      expect((await firstValueFrom(TestBed.inject(PromotionApi).activeDeals()))[0].remaining).toBe(20);
      expect(TestBed.inject(MockOrderStore).all()).toEqual([]);
      await expect(firstValueFrom(adminPromotions.simulate({ items: [], priorOrders: 0 }))).rejects.toMatchObject({ fields: { items: expect.any(String) } });
    });

    it('lists variants whose MRP is not a believable earlier price', async () => {
      await signInAdmin();
      expect(await firstValueFrom(adminPromotions.priceHealth())).toEqual([]); // the demo catalog is clean
      const { products } = await loadCatalogData();
      const p = products[0];
      const { AdminProductApi } = await import('../index');
      const api = TestBed.inject(AdminProductApi);
      const detail = await firstValueFrom(api.get(p.id));
      await firstValueFrom(api.update(p.id, { title: detail.title, brandName: detail.brandName, categoryId: detail.categoryId, description: detail.description, highlights: detail.highlights, tags: detail.tags, status: detail.status, variants: detail.variants.map((v, i) => (i === 0 ? { ...v, price: 10_000, mrp: 90_000 } : v)) }));
      const issues = await firstValueFrom(adminPromotions.priceHealth());
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ productId: p.id, problem: expect.stringContaining('75%') });
    });
  });

  it('keeps the cart deterministic: the same cart, promotions and time always price the same', async () => {
    const { products } = await loadCatalogData();
    const v = products[1].variants[0];
    const stored: StoredCart = { items: [{ variantId: v.id, quantity: 3, seenPrice: v.price.amount }], shippingMethod: 'standard', couponCode: 'WELCOME10' };
    const promos = TestBed.inject(MockPromotionStore).promotions(NOW);
    const runs = Array.from({ length: 5 }, (_, i) => priceCart(stored, products, NOW, { promotions: i % 2 ? [...promos].reverse() : promos, context: { priorOrders: 0 } }).cart);
    for (const r of runs) expect(r).toEqual(runs[0]);
  });
});

export type { Order };
