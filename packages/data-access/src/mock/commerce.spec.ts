import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { Product, PlaceOrderRequest } from '@ecom/contracts';
import { CartApi, CatalogApi, CheckoutApi, OrderApi, PaymentApi, mockSignature, provideDataAccess } from '../index';
import { EMPTY_STORED_CART, evaluateCoupon, priceCart, shippingFee } from './cart-engine';

const variant = (id: string, price: number, stock: number, mrp?: number) => ({ id, sku: id, options: { size: 'M' }, price: { amount: price, currency: 'INR' as const }, stock, ...(mrp ? { mrp: { amount: mrp, currency: 'INR' as const } } : {}) });
const product = (id: string, root: string, variants: ReturnType<typeof variant>[]): Product =>
  ({
    id,
    slug: id,
    title: `Product ${id}`,
    brandId: 'brand-x',
    brandName: 'X',
    categoryId: 'cat-leaf',
    categoryPath: [{ id: root, slug: root, name: root }],
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

const NOW = Date.UTC(2026, 8, 27);

describe('cart engine', () => {
  const products = [product('a', 'cat-fashion', [variant('a1', 100_000, 5, 125_000)]), product('b', 'cat-grocery', [variant('b1', 20_000, 1)]), product('c', 'cat-electronics', [variant('c1', 50_000, 0)])];

  it('prices lines, savings, GST-included tax and shipping', () => {
    const { cart } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'a1', quantity: 2, seenPrice: 100_000 }] }, products, NOW);
    expect(cart.totals.subtotal.amount).toBe(200_000);
    expect(cart.totals.mrpSavings.amount).toBe(50_000);
    expect(cart.totals.shipping.amount).toBe(0); // above the free-shipping threshold
    // fashion GST 12% inclusive: 200000 - 200000/1.12
    expect(cart.totals.taxIncluded.amount).toBe(Math.round(200_000 - 200_000 / 1.12));
    expect(cart.totals.total.amount).toBe(200_000);
  });

  it('charges shipping under the threshold and reports the gap to free shipping', () => {
    const { cart } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'b1', quantity: 1, seenPrice: 20_000 }] }, products, NOW);
    expect(cart.totals.shipping.amount).toBe(4_900);
    expect(cart.totals.total.amount).toBe(24_900);
    expect(cart.totals.amountToFreeShipping?.amount).toBe(29_900);
  });

  it('clamps quantity to stock and reports it', () => {
    const { cart, stored } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'b1', quantity: 4, seenPrice: 20_000 }] }, products, NOW);
    expect(cart.lines[0].quantity).toBe(1);
    expect(cart.lines[0].issue).toBe('quantity_reduced');
    expect(stored.items[0].quantity).toBe(1);
    expect(cart.notices.join(' ')).toContain('Only 1');
  });

  it('flags out-of-stock lines, excludes them from totals and blocks checkout', () => {
    const { cart } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'c1', quantity: 1, seenPrice: 50_000 }] }, products, NOW);
    expect(cart.blocked).toBe(true);
    expect(cart.lines[0].issue).toBe('out_of_stock');
    expect(cart.totals.total.amount).toBe(0);
  });

  it('detects a price change since the shopper last saw it', () => {
    const { cart } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'a1', quantity: 1, seenPrice: 90_000 }] }, products, NOW);
    expect(cart.lines[0].issue).toBe('price_changed');
    expect(cart.lines[0].previousUnitPrice?.amount).toBe(90_000);
  });

  it('drops unknown variants', () => {
    const { cart } = priceCart({ ...EMPTY_STORED_CART, items: [{ variantId: 'zzz', quantity: 1, seenPrice: 1 }] }, products, NOW);
    expect(cart.lines).toHaveLength(0);
    expect(cart.notices.length).toBe(1);
  });

  it('applies coupons with minimums, caps and expiry, and removes one that stops qualifying', () => {
    expect(evaluateCoupon('nope', 100_000, NOW)).toMatchObject({ ok: false });
    expect(evaluateCoupon('EXPIRED50', 100_000, NOW)).toMatchObject({ ok: false, message: 'This coupon has expired.' });
    expect(evaluateCoupon('WELCOME10', 50_000, NOW)).toMatchObject({ ok: false });
    expect(evaluateCoupon('WELCOME10', 100_000, NOW)).toMatchObject({ ok: true, discount: 10_000 });
    expect(evaluateCoupon('WELCOME10', 900_000, NOW)).toMatchObject({ ok: true, discount: 50_000 }); // capped
    const { cart, stored } = priceCart({ items: [{ variantId: 'b1', quantity: 1, seenPrice: 20_000 }], couponCode: 'WELCOME10', shippingMethod: 'standard' }, products, NOW);
    expect(cart.coupon).toBeUndefined();
    expect(stored.couponCode).toBeUndefined();
    expect(cart.notices.join(' ')).toContain('WELCOME10');
  });

  it('free-shipping coupon and express fee', () => {
    expect(shippingFee('standard', 10_000, true)).toBe(0);
    expect(shippingFee('express', 10_000, false)).toBe(9_900);
    expect(shippingFee('standard', 0, false)).toBe(0);
  });
});

describe('cart, checkout, order and payment mocks', () => {
  const contact = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' };
  const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  let cart: CartApi;
  let orders: OrderApi;
  let payments: PaymentApi;
  let checkout: CheckoutApi;
  let variantId: string;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true }),
      ],
    });
    cart = TestBed.inject(CartApi);
    orders = TestBed.inject(OrderApi);
    payments = TestBed.inject(PaymentApi);
    checkout = TestBed.inject(CheckoutApi);
    // Find a variant with plenty of stock so quantity rules do not interfere with the flows under test.
    const catalog = TestBed.inject(CatalogApi);
    const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 50 }));
    const found = (await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 20);
    if (!found) throw new Error('fixture has no well-stocked variant');
    variantId = found.id;
  });

  const req = (overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({ idempotencyKey: 'key-1', contact, address, paymentMethod: 'cod', ...overrides });

  it('adds, updates and removes items and persists the cart', async () => {
    let c = await firstValueFrom(cart.add(variantId, 2));
    expect(c.lines[0].quantity).toBe(2);
    c = await firstValueFrom(cart.add(variantId, 1));
    expect(c.lines[0].quantity).toBe(3);
    expect((await firstValueFrom(cart.get())).lines).toHaveLength(1);
    c = await firstValueFrom(cart.setQuantity(variantId, 5));
    expect(c.lines[0].quantity).toBe(5);
    c = await firstValueFrom(cart.remove(variantId));
    expect(c.lines).toHaveLength(0);
    await expect(firstValueFrom(cart.add('nope', 1))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('applies and removes a coupon and rejects bad ones', async () => {
    await firstValueFrom(cart.add(variantId, 10));
    await expect(firstValueFrom(cart.applyCoupon('bogus'))).rejects.toMatchObject({ code: 'validation' });
    const withCoupon = await firstValueFrom(cart.applyCoupon('flat100'));
    expect(withCoupon.coupon?.code).toBe('FLAT100');
    expect(withCoupon.totals.couponDiscount.amount).toBe(10_000);
    expect((await firstValueFrom(cart.removeCoupon())).coupon).toBeUndefined();
  });

  it('offers shipping and payment options and blocks undeliverable pin codes', async () => {
    await firstValueFrom(cart.add(variantId, 1));
    const shipping = await firstValueFrom(checkout.shippingOptions('560001'));
    expect(shipping.map((s) => s.id)).toEqual(['standard', 'express']);
    const pay = await firstValueFrom(checkout.paymentOptions('560001'));
    expect(pay.find((p) => p.method === 'razorpay')?.enabled).toBe(true);
    await expect(firstValueFrom(checkout.shippingOptions('900001'))).rejects.toMatchObject({ code: 'validation' });
    await expect(firstValueFrom(checkout.shippingOptions('12'))).rejects.toMatchObject({ code: 'validation' });
    const blocked = await firstValueFrom(checkout.paymentOptions('700001'));
    expect(blocked.find((p) => p.method === 'cod')?.enabled).toBe(false);
  });

  it('places a COD order idempotently and clears the cart', async () => {
    await firstValueFrom(cart.add(variantId, 1));
    const first = await firstValueFrom(orders.place(req()));
    const again = await firstValueFrom(orders.place(req()));
    expect(first.status).toBe('confirmed');
    expect(first.paymentStatus).toBe('cod');
    expect(again.id).toBe(first.id);
    expect((await firstValueFrom(orders.list())).length).toBe(1);
    expect((await firstValueFrom(cart.get())).lines).toHaveLength(0);
  });

  it('validates the order form fields and an empty cart', async () => {
    await expect(firstValueFrom(orders.place(req()))).rejects.toMatchObject({ message: 'Your cart is empty.' });
    await firstValueFrom(cart.add(variantId, 1));
    const bad = firstValueFrom(orders.place(req({ idempotencyKey: 'k2', contact: { ...contact, phone: '123', email: 'x' } })));
    await expect(bad).rejects.toMatchObject({ code: 'validation', fields: { phone: expect.any(String), email: expect.any(String) } });
  });

  it('runs the online payment flow: pending, failure, retry, verified success', async () => {
    await firstValueFrom(cart.add(variantId, 1));
    const order = await firstValueFrom(orders.place(req({ paymentMethod: 'razorpay' })));
    expect(order.status).toBe('pending_payment');
    expect((await firstValueFrom(cart.get())).lines).toHaveLength(1); // cart kept until paid

    const session = await firstValueFrom(payments.initiate(order.id));
    expect(session.amount).toBe(order.totals.total.amount);
    expect((await firstValueFrom(payments.fail(order.id, 'declined'))).paymentStatus).toBe('failed');

    const bad = { providerOrderId: session.providerOrderId, providerPaymentId: 'pay_1', signature: 'forged' };
    await expect(firstValueFrom(payments.confirm(order.id, bad))).rejects.toMatchObject({ code: 'validation' });

    const good = { ...bad, signature: mockSignature(session.providerOrderId, 'pay_1') };
    const paid = await firstValueFrom(payments.confirm(order.id, good));
    expect(paid.status).toBe('confirmed');
    expect(paid.paymentStatus).toBe('paid');
    expect(paid.timeline.map((t) => t.status)).toEqual(['placed', 'paid', 'confirmed']);
    expect((await firstValueFrom(cart.get())).lines).toHaveLength(0);
  });

  it('cancels an order and marks a refund for prepaid orders', async () => {
    await firstValueFrom(cart.add(variantId, 1));
    const order = await firstValueFrom(orders.place(req({ paymentMethod: 'razorpay' })));
    const session = await firstValueFrom(payments.initiate(order.id));
    await firstValueFrom(payments.confirm(order.id, { providerOrderId: session.providerOrderId, providerPaymentId: 'p', signature: mockSignature(session.providerOrderId, 'p') }));
    const cancelled = await firstValueFrom(orders.cancel(order.id));
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.paymentStatus).toBe('refund_pending');
    await expect(firstValueFrom(orders.get('ORD-NOPE'))).rejects.toMatchObject({ code: 'not_found' });
  });
});
