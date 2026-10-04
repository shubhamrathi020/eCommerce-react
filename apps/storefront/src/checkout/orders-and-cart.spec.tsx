import { act } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import type { Order } from '@ecom/contracts';
import { I18nService, type Injector } from '@shop/core';
import { AdminReturnApi, AuthApi, CartApi, DEMO_ACCOUNTS, MockOrderStore, OrderApi, SellerPortalApi, loadCatalogData } from '@shop/data-access';
import { AuthStore, CartStore } from '@shop/state';
import { button, click, fillSelector, violations } from '@shop/ui/testing';
import { open, openSignedIn } from '../test-harness';

const [customer, admin] = DEMO_ACCOUNTS;
const text = (root: HTMLElement) => root.textContent ?? '';
const links = (root: HTMLElement) => Array.from(root.querySelectorAll('a')).map((a) => a.textContent?.trim());

async function orderOf(status: Order['status'], paymentStatus: Order['paymentStatus'], userId: string | undefined): Promise<Order> {
  const { products } = await loadCatalogData();
  const p = products.find((x) => x.variants[0].stock > 10) as (typeof products)[number];
  const v = p.variants[0];
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const money = (amount: number) => ({ amount, currency: 'INR' as const });
  return {
    id: `ORD-${status}-${paymentStatus}`.toUpperCase(),
    status,
    paymentStatus,
    paymentMethod: paymentStatus === 'cod' ? 'cod' : 'razorpay',
    lines: [{ productId: p.id, variantId: v.id, slug: p.slug, title: p.title, brandName: p.brandName, image: p.images[0], options: v.options, unitPrice: v.price, quantity: 1, maxQuantity: 10, lineTotal: v.price, taxIncluded: money(0) }],
    totals: { itemCount: 1, subtotal: v.price, mrpSavings: money(0), couponDiscount: money(0), shipping: money(0), taxIncluded: money(0), total: v.price },
    shippingMethod: 'standard',
    contact: { name: customer.name, email: customer.email, phone: '9876543210' },
    address: { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    timeline: [
      { status: 'placed', label: 'Order placed', at },
      ...(status === 'cancelled' ? [{ status: 'cancelled' as const, label: 'Order cancelled', at }] : [{ status: 'confirmed' as const, label: 'Order confirmed', at }]),
    ],
    createdAt: at,
    ...(userId ? { userId } : {}),
  };
}

/** Mock orders deliver themselves six minutes after confirmation, so back-date the confirmation. */
const delivered = (order: Order): Order => ({ ...order, timeline: order.timeline.map((t) => (t.status === 'confirmed' ? { ...t, at: new Date(Date.now() - 3_600_000).toISOString() } : t)) });

describe('order page: returns, help and refund status', () => {
  it('offers "Return items" and "Get help" to the customer who placed a delivered order', async () => {
    const order = await orderOf('confirmed', 'cod', customer.id);
    const page = await openSignedIn(`/orders/${order.id}`, async (injector) => {
      injector.get(MockOrderStore).save(delivered(order));
    });
    await page.settle();
    const main = page.main();
    expect(text(main)).toContain('Delivered');
    expect(links(main)).toEqual(expect.arrayContaining(['Return items', 'Get help']));
  });

  it('offers neither to a guest who found the order link', async () => {
    const order = await orderOf('confirmed', 'cod', undefined);
    const page = await open(`/orders/${order.id}`, async (injector) => {
      injector.get(MockOrderStore).save(delivered(order));
    });
    await page.settle();
    const main = page.main();
    expect(links(main)).not.toContain('Return items');
    expect(links(main)).not.toContain('Get help');
  });

  it('moves a cancelled prepaid order from "refund in progress" to "refunded" once staff pay it', async () => {
    const order = await orderOf('cancelled', 'refund_pending', customer.id);
    const page = await openSignedIn(`/orders/${order.id}`, async (injector) => {
      injector.get(MockOrderStore).save(order);
    });
    await page.settle();
    expect(text(page.main())).toContain('Your refund will be returned to the original payment method.');

    const auth = page.injector.get(AuthStore);
    await auth.logout();
    await auth.login(admin.email, admin.password);
    await firstValueFrom(page.injector.get(AdminReturnApi).refundOrder(order.id));
    await auth.logout();
    await auth.login(customer.email, customer.password);
    await firstValueFrom(page.injector.get(AuthApi).me());
    await page.go('/');
    await page.go(`/orders/${order.id}`);
    expect(text(page.main())).toContain('Refunded to your original payment method on');
  });

  it('shows a multi-seller order as separate shipments, each with its own status and tracking', async () => {
    let orderId = '';
    const page = await openSignedIn('/', async (injector) => {
      const { products } = await loadCatalogData();
      const variantOf = (id: string) => products.find((p) => p.id === id)?.variants[0].id as string;
      await firstValueFrom(injector.get(CartApi).add(variantOf('p-0010'), 1));
      await firstValueFrom(injector.get(CartApi).add(variantOf('p-0100'), 1));
      const order = await firstValueFrom(
        injector.get(OrderApi).place({ idempotencyKey: 'k-split', contact: { name: 'Asha Rao', email: customer.email, phone: '9876543210' }, address: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, paymentMethod: 'cod' }),
      );
      orderId = order.id;

      const auth = injector.get(AuthStore);
      await auth.logout();
      await auth.login('seller@shop.test', 'Seller@1234');
      const portal = injector.get(SellerPortalApi);
      const [mine] = await firstValueFrom(portal.shipments());
      await firstValueFrom(portal.advanceShipment(mine.id));
      await firstValueFrom(portal.advanceShipment(mine.id, 'DLV-SPLIT-1'));
      await auth.logout();
      await auth.login(customer.email, customer.password);
    });

    await page.go(`/orders/${orderId}`);
    const section = page.main().querySelector('section[aria-labelledby="shipments"]') as HTMLElement;
    expect(text(section)).toContain('ships in 2 parts');
    expect(text(section)).toContain('From Urban Threads');
    expect(text(section)).toContain('Shipped');
    expect(text(section)).toContain('DLV-SPLIT-1');
    expect(text(section)).toContain('From Acme Home & Kitchen');
    expect(text(section)).toContain('Confirmed');
  }, 30000);
});

/** Puts one item in the cart before the page is drawn. */
async function withItem(injector: Injector, productId: string, quantity: number) {
  const { products } = await loadCatalogData();
  const store = injector.get(CartStore);
  await store.refresh();
  await store.add({ productId, variantId: products.find((p) => p.id === productId)?.variants[0].id as string, quantity, title: 'T', openMiniCart: false });
  return store;
}

describe('cart: automatic offers and gift cards', () => {
  it('shows each offer as its own saving line, then applies and removes a gift card', async () => {
    let store!: CartStore;
    const page = await open('/cart', async (injector) => {
      store = await withItem(injector, 'p-0002', 1);
    });
    await page.settle();
    let main = page.main();
    expect(text(main)).toContain('Fashion fest');
    expect(text(main)).toContain('10% off');
    expect(text(main)).toContain('Welcome offer');
    expect(await violations(page.root())).toEqual([]);
    const before = store.cart()?.totals.total.amount as number;

    // A wrong code is refused beside the field; the right one reduces what is left to pay.
    const apply = () => {
      const all = Array.from(main.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Apply');
      return all[all.length - 1];
    };
    await fillSelector(main, 'input[name="giftcard"]', 'NOPE');
    await click(apply());
    await page.settle();
    expect(text(main)).toContain('This gift card code is not valid.');

    main = page.main();
    await fillSelector(main, 'input[name="giftcard"]', 'GIFT500');
    await click(apply());
    await page.settle(15);
    main = page.main();
    expect(text(main)).toContain('Gift card GIFT500 applied');
    expect(text(main)).toContain('To pay');
    expect(store.cart()?.totals.total.amount).toBe(before - 50_000);
    expect(await violations(page.root())).toEqual([]);

    const panel = main.querySelector('section[aria-label="Gift card and store credit"]') as HTMLElement;
    await click(button(panel, 'Remove'));
    await page.settle(15);
    expect(store.cart()?.totals.total.amount).toBe(before);
  });
});

describe('cart page in another language', () => {
  it('shows labels, plurals and prices in Hindi without changing a single stored amount', async () => {
    let store!: CartStore;
    const page = await open('/cart', async (injector) => {
      store = await withItem(injector, 'p-0002', 2);
    });
    await page.settle();
    const main = page.main();
    const english = text(main);
    expect(english).toContain('Your cart');
    expect(english).toContain('Proceed to checkout');
    const total = store.cart()?.totals.total.amount as number;

    await act(async () => page.injector.get(I18nService).set('hi'));
    await page.settle(4);
    const hindi = text(main);
    expect(main.querySelector('h1')?.textContent).toBe('आपका कार्ट');
    expect(hindi).toContain('चेकआउट पर जाएँ');
    expect(hindi).toContain('सामान (2)');
    expect(hindi).toContain('जीएसटी सहित');
    expect(hindi).toContain('कूपन कोड');
    expect(hindi).toContain('गिफ़्ट कार्ड कोड');
    expect(hindi).not.toContain('Proceed to checkout');
    expect(hindi).not.toContain('Coupon code');
    // The amounts are formatted for the locale, never recomputed.
    expect(store.cart()?.totals.total.amount).toBe(total);
    expect(hindi).toMatch(/₹[\d,]+/);
    expect(await violations(page.root())).toEqual([]);
  });
});
