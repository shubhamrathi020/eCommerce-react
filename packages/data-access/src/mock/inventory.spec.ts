import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { PlaceOrderRequest, Product } from '@ecom/contracts';
import { AdminInventoryApi, AdminOrderApi, AdminProductApi, AuditApi, AuthApi, CartApi, CatalogApi, DEMO_ACCOUNTS, OrderApi, PaymentApi, mockSignature, provideAdminDataAccess, provideDataAccess } from '../index';
import { MockInventoryStore } from './inventory-store';
import { csvCell, parseCsv } from './admin/mock-admin-inventory.api';

const MIN = 60_000;
const variant = (id: string, stock: number) => ({ id, sku: `SKU-${id}`, options: { size: 'M' }, price: { amount: 100_000, currency: 'INR' as const }, stock });
const product = (id: string, variants: ReturnType<typeof variant>[]): Product =>
  ({
    id,
    slug: id,
    title: `Product ${id}`,
    brandId: 'b',
    brandName: 'B',
    categoryId: 'c',
    categoryPath: [{ id: 'r', slug: 'r', name: 'r' }],
    description: '',
    highlights: [],
    images: [{ url: '/i.svg', alt: 'i', width: 1, height: 1 }],
    attributes: {},
    variantAxes: ['size'],
    variants,
    rating: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    popularity: 1,
  }) as Product;

const config = { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} };

function fresh() {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: config }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })] });
}

const onHand = (store: MockInventoryStore, products: Product[], variantId: string) => store.apply(products, 'onHand').flatMap((p) => p.variants).find((v) => v.id === variantId)?.stock;
const available = (store: MockInventoryStore, products: Product[], variantId: string) => store.apply(products).flatMap((p) => p.variants).find((v) => v.id === variantId)?.stock;

describe('inventory store', () => {
  let store: MockInventoryStore;
  let products: Product[];
  beforeEach(() => {
    fresh();
    store = TestBed.inject(MockInventoryStore);
    products = [product('p1', [variant('v1', 5)]), product('p2', [variant('v2', 1), variant('v3', 0)])];
  });

  it('returns the catalog untouched until stock moves', () => {
    expect(store.apply(products)).toBe(products);
  });

  it('sales reduce stock, cancellations restore it, and the ledger explains every unit', () => {
    store.sell('o1', [{ variantId: 'v1', quantity: 2 }], products, 'Checkout');
    expect(onHand(store, products, 'v1')).toBe(3);
    store.restore('o1', products);
    expect(onHand(store, products, 'v1')).toBe(5);
    store.restore('o1', products); // already restored: nothing more to put back
    expect(onHand(store, products, 'v1')).toBe(5);
    const ledger = store.movements();
    expect(ledger.map((m) => [m.kind, m.quantity])).toEqual([['cancellation', 2], ['sale', -2]]);
    expect(ledger.reduce((sum, m) => sum + m.quantity, 5)).toBe(5);
    // selling twice for the same order is a no-op
    store.sell('o2', [{ variantId: 'v1', quantity: 1 }], products);
    store.sell('o2', [{ variantId: 'v1', quantity: 1 }], products);
    expect(onHand(store, products, 'v1')).toBe(4);
  });

  it('a reservation holds units so two shoppers cannot both buy the last one', () => {
    const t = Date.now();
    store.reserve('o1', [{ variantId: 'v2', quantity: 1 }], products, t);
    expect(available(store, products, 'v2')).toBe(0);
    expect(onHand(store, products, 'v2')).toBe(1);
    expect(() => store.reserve('o2', [{ variantId: 'v2', quantity: 1 }], products, t)).toThrow(/just sold out/);
    expect(() => store.sell('o3', [{ variantId: 'v2', quantity: 1 }], products, 'Checkout', t)).toThrow(/just sold out/);
    store.release('o1', products, t);
    expect(available(store, products, 'v2')).toBe(1);
    store.reserve('o2', [{ variantId: 'v2', quantity: 1 }], products, t);
  });

  it('says how many are left when a line asks for too many', () => {
    expect(() => store.reserve('o1', [{ variantId: 'v1', quantity: 9 }], products)).toThrow(/only 5 of Product p1 left/);
  });

  it('reservations expire after the configured time and free their stock', () => {
    const t = 1_000_000;
    store.reserve('o1', [{ variantId: 'v1', quantity: 3 }], products, t);
    expect(store.expire(products, t + 14 * MIN)).toEqual([]);
    expect(store.apply(products, 'available', t + 14 * MIN)[0].variants[0].stock).toBe(2);
    expect(store.apply(products, 'available', t + 16 * MIN)[0].variants[0].stock).toBe(5); // expired holds no longer count
    expect(store.expire(products, t + 15 * MIN)).toEqual(['o1']);
    expect(store.expire(products, t + 16 * MIN)).toEqual([]);
    store.saveSettings({ reservationMinutes: 1, lowStockThreshold: 5 }, products);
    store.reserve('o2', [{ variantId: 'v1', quantity: 1 }], products, t);
    expect(store.expire(products, t + MIN)).toEqual(['o2']);
  });

  it('paying turns the reservation into a sale without counting the units twice', () => {
    store.reserve('o1', [{ variantId: 'v1', quantity: 2 }], products);
    store.sell('o1', [{ variantId: 'v1', quantity: 2 }], products, 'Payment');
    expect(onHand(store, products, 'v1')).toBe(3);
    expect(available(store, products, 'v1')).toBe(3);
  });

  it('sales come from the first location that can fulfil the whole line', () => {
    store.adjust({ variantId: 'v1', locationId: 'loc-blr', kind: 'receive', quantity: 10, reason: 'received_shipment' }, products, 'Ops');
    store.sell('o1', [{ variantId: 'v1', quantity: 4 }], products); // main has 5
    store.sell('o2', [{ variantId: 'v1', quantity: 4 }], products); // main has 1, hub can fulfil all 4
    const row = store.rows(products).find((r) => r.variantId === 'v1');
    expect(row?.byLocation).toEqual({ 'loc-main': 1, 'loc-blr': 6 });
    store.sell('o3', [{ variantId: 'v1', quantity: 7 }], products); // nobody can fulfil 7 alone: drain main then hub
    expect(store.rows(products).find((r) => r.variantId === 'v1')?.byLocation).toEqual({ 'loc-main': 0, 'loc-blr': 0 });
    expect(store.rows(products).find((r) => r.variantId === 'v1')?.onHand).toBe(0);
  });

  it('adjustments need a fitting reason and cannot take stock below zero', () => {
    const adjust = (over: object) => () => store.adjust({ variantId: 'v1', locationId: 'loc-main', kind: 'receive', quantity: 1, reason: 'received_shipment', ...over }, products, 'Ops');
    expect(adjust({ reason: '' })).toThrow(/highlighted/);
    try {
      adjust({ reason: '' })();
    } catch (e) {
      expect((e as { fields: Record<string, string> }).fields['reason']).toBe('Choose a reason');
    }
    expect(adjust({ reason: 'damaged' })).toThrow(); // "damaged" does not describe a receipt
    expect(adjust({ reason: 'other' })).toThrow(); // other needs an explanation
    expect(adjust({ quantity: 0 })).toThrow();
    expect(adjust({ quantity: 1.5 })).toThrow();
    expect(adjust({ kind: 'damage', reason: 'damaged', quantity: 6 })).toThrow(/cannot go below zero/);
    expect(store.movements()).toHaveLength(0);
    adjust({ kind: 'damage', reason: 'damaged', quantity: 2, note: 'Dropped in aisle 4' })();
    expect(onHand(store, products, 'v1')).toBe(3);
    expect(store.movements()[0]).toMatchObject({ kind: 'damage', quantity: -2, reason: 'damaged', note: 'Dropped in aisle 4', actor: 'Ops' });
  });

  it('a transfer is a matching pair of ledger entries and cannot overdraw the source', () => {
    store.transfer({ variantId: 'v1', fromLocationId: 'loc-main', toLocationId: 'loc-blr', quantity: 3 }, products, 'Ops');
    const [a, b] = store.movements();
    expect(a.transferId).toBe(b.transferId);
    expect(a.quantity + b.quantity).toBe(0);
    expect(store.rows(products)[0].byLocation).toEqual({ 'loc-main': 2, 'loc-blr': 3 });
    expect(store.rows(products)[0].onHand).toBe(5);
    expect(() => store.transfer({ variantId: 'v1', fromLocationId: 'loc-main', toLocationId: 'loc-blr', quantity: 3 }, products, 'Ops')).toThrow(/Only 2/);
    expect(() => store.transfer({ variantId: 'v1', fromLocationId: 'loc-main', toLocationId: 'loc-main', quantity: 1 }, products, 'Ops')).toThrow();
  });

  it('raises one low-stock alert per variant until it is restocked', () => {
    store.sell('o1', [{ variantId: 'v1', quantity: 1 }], products); // 4 left, threshold 5
    expect(store.alerts().map((a) => a.variantId)).toEqual(['v1']);
    store.sell('o2', [{ variantId: 'v1', quantity: 1 }], products);
    expect(store.alerts()).toHaveLength(1);
    expect(store.alerts()[0].available).toBe(3);
    store.adjust({ variantId: 'v1', locationId: 'loc-main', kind: 'receive', quantity: 20, reason: 'received_shipment' }, products, 'Ops');
    expect(store.alerts()).toHaveLength(0);
    store.setPolicy('v1', { backorder: false, threshold: 30 }, products);
    expect(store.alerts()).toHaveLength(1);
    expect(store.rows(products)[0]).toMatchObject({ threshold: 30, customThreshold: true, low: true });
  });

  it('backorder lets a flagged variant be bought at zero stock, nothing else', () => {
    expect(() => store.reserve('o1', [{ variantId: 'v3', quantity: 1 }], products)).toThrow(/sold out/);
    store.setPolicy('v3', { backorder: true, expectedDate: '2026-11-01' }, products);
    const shown = store.apply(products).flatMap((p) => p.variants).find((v) => v.id === 'v3');
    expect(shown).toMatchObject({ stock: 0, backorder: { expectedDate: '2026-11-01' } });
    store.sell('o1', [{ variantId: 'v3', quantity: 2 }], products);
    expect(onHand(store, products, 'v3')).toBe(-2);
    expect(available(store, products, 'v3')).toBe(0);
    expect(() => store.setPolicy('v3', { backorder: true, expectedDate: 'not a date' }, products)).toThrow();
    expect(() => store.setPolicy('v3', { backorder: false, threshold: -1 }, products)).toThrow();
  });

  it('validates settings', () => {
    expect(() => store.saveSettings({ reservationMinutes: 0, lowStockThreshold: 5 }, products)).toThrow();
    expect(() => store.saveSettings({ reservationMinutes: 15, lowStockThreshold: -1 }, products)).toThrow();
    store.saveSettings({ reservationMinutes: 30, lowStockThreshold: 2 }, products);
    expect(store.settings()).toEqual({ reservationMinutes: 30, lowStockThreshold: 2 });
  });
});

describe('csv helpers', () => {
  it('reads quoted cells, doubled quotes and both line endings', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });

  it('quotes cells and defuses spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-3)).toBe('-3');
  });
});

describe('inventory through the shop and admin APIs', () => {
  const contact = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' };
  const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  const admin = DEMO_ACCOUNTS[1];
  const customer = DEMO_ACCOUNTS[0];
  const req = (overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({ idempotencyKey: 'key-1', contact, address, paymentMethod: 'cod', ...overrides });
  let cart: CartApi;
  let orders: OrderApi;
  let payments: PaymentApi;
  let catalog: CatalogApi;
  let inventory: AdminInventoryApi;
  let auth: AuthApi;
  let variantId: string;
  let productId: string;
  let sku: string;

  /** On-hand row for one SKU, read through the admin API. */
  const rowOf = async (code: string) => (await firstValueFrom(inventory.overview({ q: code, filter: 'all', page: 1, pageSize: 20 }))).items.find((r) => r.sku === code);

  const stockOf = async () => (await firstValueFrom(catalog.productsByIds([productId])))[0].variants.find((v) => v.id === variantId)?.stock ?? -1;

  beforeEach(async () => {
    fresh();
    cart = TestBed.inject(CartApi);
    orders = TestBed.inject(OrderApi);
    payments = TestBed.inject(PaymentApi);
    catalog = TestBed.inject(CatalogApi);
    inventory = TestBed.inject(AdminInventoryApi);
    auth = TestBed.inject(AuthApi);
    const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 50 }));
    const found = (await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)))).map((p) => ({ p, v: p.variants.find((v) => v.stock >= 20) })).find((x) => x.v);
    if (!found?.v) throw new Error('fixture has no well-stocked variant');
    variantId = found.v.id;
    productId = found.p.id;
    sku = found.v.sku;
  });

  it('cash on delivery reduces stock at once and a cancellation puts it back', async () => {
    const before = await stockOf();
    await firstValueFrom(cart.add(variantId, 1)); // cash on delivery has an order value limit, so keep it small
    const order = await firstValueFrom(orders.place(req()));
    expect(await stockOf()).toBe(before - 1);
    await firstValueFrom(orders.cancel(order.id));
    expect(await stockOf()).toBe(before);
  });

  it('online orders hold stock while unpaid, release it on failure and sell it on payment', async () => {
    const before = await stockOf();
    await firstValueFrom(cart.add(variantId, 2));
    const order = await firstValueFrom(orders.place(req({ paymentMethod: 'razorpay' })));
    expect(await stockOf()).toBe(before - 2); // held for this order
    const session = await firstValueFrom(payments.initiate(order.id));
    await firstValueFrom(payments.fail(order.id, 'declined'));
    expect(await stockOf()).toBe(before); // released
    const paid = await firstValueFrom(payments.confirm(order.id, { providerOrderId: session.providerOrderId, providerPaymentId: 'p1', signature: mockSignature(session.providerOrderId, 'p1') }));
    expect(paid.status).toBe('confirmed');
    expect(await stockOf()).toBe(before - 2);
    const store = TestBed.inject(MockInventoryStore);
    expect(store.movements().filter((m) => m.orderId === order.id).map((m) => m.kind)).toEqual(['sale']);
  });

  it('cancelling an unpaid order releases its hold', async () => {
    const before = await stockOf();
    await firstValueFrom(cart.add(variantId, 2));
    const order = await firstValueFrom(orders.place(req({ paymentMethod: 'razorpay' })));
    await firstValueFrom(orders.cancel(order.id));
    expect(await stockOf()).toBe(before);
    expect(TestBed.inject(MockInventoryStore).movements()).toHaveLength(0);
  });

  it('an abandoned payment is cancelled after the reservation time and frees its stock', async () => {
    const before = await stockOf();
    await firstValueFrom(cart.add(variantId, 2));
    const order = await firstValueFrom(orders.place(req({ paymentMethod: 'razorpay' })));
    // Move the clock past the reservation window.
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * MIN;
    try {
      const later = await firstValueFrom(orders.get(order.id));
      expect(later.status).toBe('cancelled');
      expect(later.timeline.at(-1)?.label).toContain('payment window expired');
      expect(await stockOf()).toBe(before);
      const session = { providerOrderId: `order_mock_${order.id}` };
      await expect(firstValueFrom(payments.confirm(order.id, { ...session, providerPaymentId: 'p', signature: mockSignature(session.providerOrderId, 'p') }))).rejects.toMatchObject({ message: expect.stringContaining('payment window') });
    } finally {
      Date.now = realNow;
    }
  });

  it('trims the cart and the order to what is left when someone else took units first', async () => {
    const store = TestBed.inject(MockInventoryStore);
    const before = await stockOf();
    await firstValueFrom(cart.add(variantId, 5));
    // Another shopper takes almost everything after this cart was priced.
    const all = (await firstValueFrom(catalog.productsByIds([productId])))[0];
    store.sell('rival', [{ variantId, quantity: before - 2 }], [all]);
    const cartNow = await firstValueFrom(cart.get());
    expect(cartNow.lines[0].quantity).toBe(2); // the cart is trimmed to what is left
    const order = await firstValueFrom(orders.place(req()));
    expect(order.lines[0].quantity).toBe(2);
    expect(await stockOf()).toBe(0);
    await expect(firstValueFrom(cart.add(variantId, 1))).rejects.toMatchObject({ message: 'Sorry, this item is out of stock.' });
  });

  it('admin: stock screens need permission, adjustments are ledgered, audited and visible in the shop', async () => {
    await expect(firstValueFrom(inventory.overview({ filter: 'all', page: 1, pageSize: 10 }))).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(customer.email, customer.password));
    await expect(firstValueFrom(inventory.overview({ filter: 'all', page: 1, pageSize: 10 }))).rejects.toMatchObject({ code: 'forbidden' });
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(admin.email, admin.password));

    const before = await stockOf();
    await expect(firstValueFrom(inventory.adjust({ variantId, locationId: 'loc-main', kind: 'receive', quantity: 5, reason: '' }))).rejects.toMatchObject({ code: 'validation', fields: { reason: 'Choose a reason' } });
    await firstValueFrom(inventory.adjust({ variantId, locationId: 'loc-main', kind: 'receive', quantity: 5, reason: 'received_shipment', note: 'PO 1042' }));
    expect(await stockOf()).toBe(before + 5);

    const row = await rowOf(sku);
    expect(row).toMatchObject({ onHand: before + 5, reserved: 0, available: before + 5 });
    const ledger = await firstValueFrom(inventory.movements({ page: 1, pageSize: 10 }));
    expect(ledger.items[0]).toMatchObject({ kind: 'receive', quantity: 5, reason: 'received_shipment', note: 'PO 1042', actor: admin.name });
    const audit = (await firstValueFrom(TestBed.inject(AuditApi).list({ page: 1, pageSize: 5 }))).items;
    expect(audit[0]).toMatchObject({ action: 'inventory.adjust', actor: admin.name });
  });

  it('admin: cancelling an order in the console returns its units, and product edits cannot change stock', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const adminOrders = TestBed.inject(AdminOrderApi);
    const list = await firstValueFrom(adminOrders.list({ status: 'confirmed', page: 1, pageSize: 5 }));
    const target = await firstValueFrom(adminOrders.get(list.items[0].id));
    const line = target.lines[0];
    const products = TestBed.inject(AdminProductApi);
    const detail = await firstValueFrom(products.get(line.productId));
    const lineSku = detail.variants.find((v) => v.id === line.variantId)?.sku ?? '';
    const before = (await rowOf(lineSku))?.onHand ?? -1;
    await firstValueFrom(adminOrders.advance(target.id, 'cancelled'));
    const after = (await rowOf(lineSku))?.onHand;
    expect(after).toBe(before + line.quantity);

    await firstValueFrom(products.update(line.productId, { ...detail, variants: detail.variants.map((v) => ({ ...v, stock: 9999 })) }));
    expect((await firstValueFrom(products.get(line.productId))).variants.find((v) => v.id === line.variantId)?.stock).toBe(after);
  });

  it('admin: a new product records its opening stock in the ledger', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const products = TestBed.inject(AdminProductApi);
    const cats = await firstValueFrom(products.categories());
    const created = await firstValueFrom(products.create({ title: 'Ledger Kettle', brandName: 'Ferro', categoryId: cats[0].id, description: 'x', highlights: [], tags: [], status: 'published', variants: [{ sku: 'LEDGER-1', options: { colour: 'Black' }, price: 129900, stock: 12 }] }));
    expect(created.variants[0].stock).toBe(12);
    const ledger = await firstValueFrom(inventory.movements({ q: 'LEDGER-1', page: 1, pageSize: 5 }));
    expect(ledger.items[0]).toMatchObject({ kind: 'receive', quantity: 12, note: 'Opening stock' });
  });

  it('admin: import applies good rows together and reports the bad ones', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const rows = (await firstValueFrom(inventory.overview({ filter: 'all', page: 1, pageSize: 3 }))).items;
    const csv = ['sku,location,on_hand', `${rows[0].sku},Main warehouse,7`, `${rows[1].sku},Bengaluru hub,4`, 'NOPE-1,Main warehouse,3', `${rows[2].sku},Moon base,3`, `${rows[2].sku},Main warehouse,-2`, `${rows[0].sku},Main warehouse,9`].join('\n');
    const report = await firstValueFrom(inventory.importCsv(csv));
    expect(report.applied).toBe(2);
    expect(report.skipped.map((s) => [s.line, s.message])).toEqual([[4, 'Unknown SKU'], [5, 'Unknown location'], [6, 'on_hand must be a whole number, 0 or more'], [7, 'Duplicate row for this SKU and location']]);
    expect(report.errorCsv.split('\n')[0]).toBe('line,sku,error');
    const after = (await firstValueFrom(inventory.overview({ filter: 'all', page: 1, pageSize: 3 }))).items;
    expect(after[0].byLocation['loc-main']).toBe(7);
    expect(after[1].byLocation['loc-blr']).toBe(4);
    await expect(firstValueFrom(inventory.importCsv('a,b\n1,2'))).rejects.toMatchObject({ message: expect.stringContaining('sku, location, on_hand') });
  });

  it('admin: exported CSV round-trips through the import without changing anything', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const csv = await firstValueFrom(inventory.exportCsv());
    expect(csv.split('\n')[0]).toBe('sku,product,location,on_hand');
    const report = await firstValueFrom(inventory.importCsv(csv));
    expect(report.skipped).toEqual([]);
    expect(await firstValueFrom(inventory.movements({ page: 1, pageSize: 5 }))).toMatchObject({ total: 0 });
  });

  it('backorder shows in the shop and lets the customer buy at zero stock', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const target = await rowOf(sku);
    if (!target) throw new Error('row missing');
    await firstValueFrom(inventory.adjust({ variantId, locationId: 'loc-main', kind: 'correction', quantity: -target.byLocation['loc-main'], reason: 'count_correction' }));
    await firstValueFrom(inventory.setPolicy(variantId, { backorder: true, expectedDate: '2026-12-01' }));
    await firstValueFrom(auth.logout());
    const shown = (await firstValueFrom(catalog.productsByIds([productId])))[0].variants.find((v) => v.id === variantId);
    expect(shown).toMatchObject({ stock: 0, backorder: { expectedDate: '2026-12-01' } });
    const priced = await firstValueFrom(cart.add(variantId, 2));
    expect(priced.lines[0]).toMatchObject({ quantity: 2, backorder: { expectedDate: '2026-12-01' } });
    expect(priced.blocked).toBe(false);
    const order = await firstValueFrom(orders.place(req()));
    expect(order.status).toBe('confirmed');
  });
});
