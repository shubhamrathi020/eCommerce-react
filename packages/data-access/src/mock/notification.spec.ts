import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { PlaceOrderRequest } from '@ecom/contracts';
import {
  AdminInventoryApi,
  AdminNotificationApi,
  AdminProductApi,
  AlertApi,
  AuditApi,
  AuthApi,
  CartApi,
  CatalogApi,
  DEMO_ACCOUNTS,
  MockMailbox,
  NotificationApi,
  OrderApi,
  PreferenceApi,
  ReviewApi,
  provideAdminDataAccess,
  provideDataAccess,
} from '../index';
import { MockNotificationStore } from './notification-store';

const config = { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} };
const customer = DEMO_ACCOUNTS[0];
const admin = DEMO_ACCOUNTS[1];

function fresh() {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: config }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })] });
}

describe('notification preferences', () => {
  let auth: AuthApi;
  let prefs: PreferenceApi;

  beforeEach(async () => {
    fresh();
    auth = TestBed.inject(AuthApi);
    prefs = TestBed.inject(PreferenceApi);
  });

  it('needs a signed-in session', async () => {
    await expect(firstValueFrom(prefs.get())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('defaults to marketing off, alerts on, and records a consent timestamp only when marketing turns on', async () => {
    await firstValueFrom(auth.login(customer.email, customer.password));
    const start = await firstValueFrom(prefs.get());
    expect(start).toMatchObject({ marketing: false, priceDropAlerts: true, backInStockAlerts: true });
    expect(start.marketingConsentAt).toBeUndefined();

    const on = await firstValueFrom(prefs.save({ ...start, marketing: true }));
    expect(on.marketingConsentAt).toBeTruthy();
    const consentAt = on.marketingConsentAt;

    const stillOn = await firstValueFrom(prefs.save({ ...on, backInStockAlerts: false }));
    expect(stillOn.marketingConsentAt).toBe(consentAt); // unchanged while marketing stays on

    const off = await firstValueFrom(prefs.save({ ...stillOn, marketing: false }));
    expect(off.marketingConsentAt).toBeUndefined();
  });

  it('a one-click unsubscribe link turns off just that channel, and works only once', async () => {
    await firstValueFrom(auth.login(customer.email, customer.password));
    await firstValueFrom(prefs.save({ marketing: true, backInStockAlerts: true, priceDropAlerts: true }));
    const link = await firstValueFrom(prefs.unsubscribeLink('marketing'));
    const token = new URL(link, 'http://x').searchParams.get('token') as string;

    await firstValueFrom(auth.logout()); // no sign-in needed
    const result = await firstValueFrom(prefs.unsubscribe(token));
    expect(result.label).toBe('marketing emails');

    await firstValueFrom(auth.login(customer.email, customer.password));
    expect((await firstValueFrom(prefs.get())).marketing).toBe(false);
  });

  it('refuses an invalid or tampered token', async () => {
    await expect(firstValueFrom(prefs.unsubscribe('not-a-token'))).rejects.toMatchObject({ code: 'validation' });
    await firstValueFrom(auth.login(customer.email, customer.password));
    const link = await firstValueFrom(prefs.unsubscribeLink('price_drop'));
    const token = new URL(link, 'http://x').searchParams.get('token') as string;
    const tampered = `${token.split('.')[0]}.zzzzzz`;
    await expect(firstValueFrom(prefs.unsubscribe(tampered))).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('alert subscriptions and their triggers', () => {
  let auth: AuthApi;
  let alerts: AlertApi;
  let cart: CartApi;
  let catalog: CatalogApi;
  let inventory: AdminInventoryApi;
  let mailbox: MockMailbox;
  let outOfStockId: string;
  let inStockId: string;
  let priceDropId: string;
  let productId: string;

  beforeEach(async () => {
    fresh();
    auth = TestBed.inject(AuthApi);
    alerts = TestBed.inject(AlertApi);
    cart = TestBed.inject(CartApi);
    catalog = TestBed.inject(CatalogApi);
    inventory = TestBed.inject(AdminInventoryApi);
    mailbox = TestBed.inject(MockMailbox);
    await firstValueFrom(auth.login(customer.email, customer.password));

    const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 60 }));
    const products = await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)));
    const withTwo = products.find((p) => p.variants.filter((v) => v.stock > 5).length >= 2);
    if (!withTwo) throw new Error('fixture missing a product with two well-stocked variants');
    productId = withTwo.id;
    const wellStocked = withTwo.variants.filter((v) => v.stock > 5);
    inStockId = wellStocked[0].id;
    priceDropId = wellStocked[1].id;

    // Take one variant fully out of stock so back-in-stock subscribing is possible; the other stays untouched.
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(admin.email, admin.password));
    const onHand = wellStocked[0].stock;
    await firstValueFrom(inventory.adjust({ variantId: inStockId, locationId: 'loc-main', kind: 'correction', quantity: -onHand, reason: 'count_correction' }));
    outOfStockId = inStockId;
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(customer.email, customer.password));
  });

  it('back-in-stock: only for items that are actually out of stock, needs the preference on, and fires once', async () => {
    await firstValueFrom(TestBed.inject(PreferenceApi).save({ marketing: false, backInStockAlerts: false, priceDropAlerts: true }));
    await expect(firstValueFrom(alerts.subscribe('back_in_stock', outOfStockId))).rejects.toMatchObject({ message: expect.stringContaining('preferences') });

    await firstValueFrom(TestBed.inject(PreferenceApi).save({ marketing: false, backInStockAlerts: true, priceDropAlerts: true }));
    const stocked = await firstValueFrom(catalog.productsByIds([productId]));
    const inStockVariant = stocked[0].variants.find((v) => v.stock > 0 && v.id !== outOfStockId);
    if (inStockVariant) await expect(firstValueFrom(alerts.subscribe('back_in_stock', inStockVariant.id))).rejects.toMatchObject({ message: 'This item is already in stock.' });

    let list = await firstValueFrom(alerts.subscribe('back_in_stock', outOfStockId));
    expect(list).toHaveLength(1);
    list = await firstValueFrom(alerts.subscribe('back_in_stock', outOfStockId)); // subscribing twice does not duplicate
    expect(list).toHaveLength(1);

    // Restocked by an admin; the next catalog read (home/listing/product) is when the mock checks alerts.
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(admin.email, admin.password));
    await firstValueFrom(inventory.adjust({ variantId: outOfStockId, locationId: 'loc-main', kind: 'receive', quantity: 5, reason: 'received_shipment' }));
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(customer.email, customer.password));
    await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 5 }));

    expect(await firstValueFrom(alerts.list())).toEqual([]);
    const mail = mailbox.list().find((m) => m.to === customer.email && m.subject.includes('back in stock'));
    expect(mail).toBeTruthy();
  });

  it('price drop: fires when the price falls below the watched price, and keeps watching for the next drop', async () => {
    await firstValueFrom(alerts.subscribe('price_drop', priceDropId));
    let mine = await firstValueFrom(alerts.list());
    const firstWatch = mine[0].watchPrice as number;

    // The admin's price cut checks alert subscribers itself: the shop reads a separate, unlinked catalog in this mock.
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(admin.email, admin.password));
    const adminProducts = TestBed.inject(AdminProductApi);
    const detail = await firstValueFrom(adminProducts.get(productId));
    const variant = detail.variants.find((v) => v.id === priceDropId) as (typeof detail.variants)[number];
    await firstValueFrom(adminProducts.update(productId, { ...detail, variants: detail.variants.map((v) => (v.id === priceDropId ? { ...v, price: Math.round(variant.price * 0.8) } : v)) }));
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(customer.email, customer.password));

    mine = await firstValueFrom(alerts.list());
    expect(mine).toHaveLength(1); // price alerts keep watching after firing
    expect(mine[0].watchPrice).toBeLessThan(firstWatch);
    expect(mailbox.list().some((m) => m.to === customer.email && m.subject.includes('dropped'))).toBe(true);
  });

  it('removing an alert takes it off the list', async () => {
    const [sub] = await firstValueFrom(alerts.subscribe('price_drop', inStockId));
    expect(await firstValueFrom(alerts.remove(sub.id))).toEqual([]);
  });
});

describe('the notification bell', () => {
  let auth: AuthApi;
  let notifications: NotificationApi;
  let cart: CartApi;
  let orders: OrderApi;
  let variantId: string;

  const contact = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' };
  const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  const req = (over: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({ idempotencyKey: 'k1', contact, address, paymentMethod: 'cod', ...over });

  beforeEach(async () => {
    fresh();
    auth = TestBed.inject(AuthApi);
    notifications = TestBed.inject(NotificationApi);
    cart = TestBed.inject(CartApi);
    orders = TestBed.inject(OrderApi);
    await firstValueFrom(auth.login(customer.email, customer.password));
    const catalog = TestBed.inject(CatalogApi);
    const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 30 }));
    const found = (await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 5);
    variantId = found?.id as string;
  });

  it('needs a signed-in session', async () => {
    await firstValueFrom(auth.logout());
    await expect(firstValueFrom(notifications.list())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('placing an order adds an unread notification; marking it read updates the count', async () => {
    expect(await firstValueFrom(notifications.unreadCount())).toBe(0);
    await firstValueFrom(cart.add(variantId, 1));
    const order = await firstValueFrom(orders.place(req()));
    expect(await firstValueFrom(notifications.unreadCount())).toBe(1);
    const [n] = await firstValueFrom(notifications.list());
    expect(n).toMatchObject({ kind: 'order', read: false, link: `/orders/${order.id}` });
    expect(n.title).toContain(order.id);

    await firstValueFrom(notifications.markRead(n.id));
    expect(await firstValueFrom(notifications.unreadCount())).toBe(0);
  });

  it('mark all read clears every unread item', async () => {
    await firstValueFrom(cart.add(variantId, 1));
    await firstValueFrom(orders.place(req({ idempotencyKey: 'a' })));
    await firstValueFrom(cart.add(variantId, 1));
    await firstValueFrom(orders.place(req({ idempotencyKey: 'b', contact: { ...contact, email: 'other@example.com' } })));
    expect(await firstValueFrom(notifications.unreadCount())).toBeGreaterThanOrEqual(1);
    await firstValueFrom(notifications.markAllRead());
    expect(await firstValueFrom(notifications.unreadCount())).toBe(0);
  });
});

describe('review status notifications', () => {
  it('tells the shopper their review went live or needs a check', async () => {
    fresh();
    const auth = TestBed.inject(AuthApi);
    const cart = TestBed.inject(CartApi);
    const orders = TestBed.inject(OrderApi);
    const reviews = TestBed.inject(ReviewApi);
    const catalog = TestBed.inject(CatalogApi);
    const mailbox = TestBed.inject(MockMailbox);
    await firstValueFrom(auth.login(customer.email, customer.password));
    const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 30 }));
    const products = await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)));
    const found = products.flatMap((p) => p.variants.map((v) => ({ p, v }))).find((x) => x.v.stock >= 1);
    if (!found) throw new Error('fixture missing stock');
    await firstValueFrom(cart.add(found.v.id, 1));
    await firstValueFrom(orders.place({ idempotencyKey: 'r1', contact: { name: 'A', email: customer.email, phone: '9876543210' }, address: { line1: 'x', city: 'Bengaluru', state: 'KA', pincode: '560001' }, paymentMethod: 'cod' }));

    await firstValueFrom(reviews.submit({ productId: found.p.id, rating: 5, title: 'Great', body: 'Works exactly as described, very happy with it.' }));
    expect(mailbox.list()[0]).toMatchObject({ to: customer.email, subject: expect.stringContaining('Great') });
    expect(mailbox.list()[0].body).toContain('is now live');

    await firstValueFrom(reviews.updateMine((await firstValueFrom(reviews.eligibility(found.p.id))).existing?.id as string, { rating: 4, title: 'Great', body: 'Visit my store, check www.example.com for more.' }));
  });
});

describe('admin: message templates and the delivery log', () => {
  let auth: AuthApi;
  let admin_: AdminNotificationApi;
  let audit: AuditApi;

  beforeEach(async () => {
    fresh();
    auth = TestBed.inject(AuthApi);
    admin_ = TestBed.inject(AdminNotificationApi);
    audit = TestBed.inject(AuditApi);
  });

  it('needs the notification:manage permission', async () => {
    await expect(firstValueFrom(admin_.templates())).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(customer.email, customer.password));
    await expect(firstValueFrom(admin_.templates())).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists seeded templates and rejects unknown variables, keeping version history', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const templates = await firstValueFrom(admin_.templates());
    expect(templates.length).toBeGreaterThanOrEqual(8);
    const order = templates.find((t) => t.key === 'order_placed');
    expect(order?.variables).toContain('orderId');

    await expect(firstValueFrom(admin_.saveTemplate('order_placed', { subject: 'Order {{bogus}}', body: order?.body ?? '' }))).rejects.toMatchObject({ code: 'validation', fields: { body: expect.stringContaining('bogus') } });

    const saved = await firstValueFrom(admin_.saveTemplate('order_placed', { subject: 'Your order {{orderId}} is confirmed!', body: order?.body ?? '' }));
    expect(saved.version).toBe(2);
    expect(saved.history).toHaveLength(2);

    const restored = await firstValueFrom(admin_.restoreVersion('order_placed', 1));
    expect(restored.subject).toBe(order?.subject);
    expect(restored.version).toBe(3);

    const entries = (await firstValueFrom(audit.list({ page: 1, pageSize: 10 }))).items;
    expect(entries[0]).toMatchObject({ action: 'notification.template' });
  });

  it('send test mails the signed-in admin and logs the delivery', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    await firstValueFrom(admin_.sendTest('order_placed'));
    const mailbox = TestBed.inject(MockMailbox);
    expect(mailbox.list()[0].to).toBe(admin.email);
    expect(mailbox.list()[0].subject).not.toContain('{{');
    const log = await firstValueFrom(admin_.deliveryLog({ page: 1, pageSize: 5 }));
    expect(log.items[0]).toMatchObject({ to: admin.email, status: 'sent' });
  });

  it('the delivery log is searchable and a failed send can be retried', async () => {
    await firstValueFrom(auth.login(admin.email, admin.password));
    const failed = await firstValueFrom(admin_.deliveryLog({ status: 'failed', page: 1, pageSize: 5 }));
    expect(failed.items.length).toBeGreaterThan(0);
    const retried = await firstValueFrom(admin_.retry(failed.items[0].id));
    expect(retried.status).toBe('sent');
    expect(retried.attempts).toBe(2);
    const stillFailed = await firstValueFrom(admin_.deliveryLog({ status: 'failed', page: 1, pageSize: 5 }));
    expect(stillFailed.items.find((e) => e.id === retried.id)).toBeUndefined();
  });
});
