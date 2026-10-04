import { act, fireEvent } from '@testing-library/react';
import type { Order } from '@ecom/contracts';
import type { Injector } from '@shop/core';
import { MockOrderStore, loadCatalogData } from '@shop/data-access';
import { button, click, field, fill, violations } from '@shop/ui/testing';
import { demo, open, openSignedIn } from '../test-harness';

const DAY = 86_400_000;
const text = (root: HTMLElement) => root.textContent ?? '';

/** A delivered cash-on-delivery order owned by the demo customer. */
async function deliveredOrder(injector: Injector, deliveredDaysAgo = 1): Promise<Order> {
  const { products } = await loadCatalogData();
  const p = products.find((x) => x.variants[0].stock > 10) as (typeof products)[number];
  const v = p.variants[0];
  const confirmedAt = new Date(Date.now() - deliveredDaysAgo * DAY - 6 * 60_000).toISOString();
  const money = (amount: number) => ({ amount, currency: 'INR' as const });
  const order: Order = {
    id: `ORD-UI${deliveredDaysAgo}`,
    status: 'delivered',
    paymentStatus: 'cod',
    paymentMethod: 'cod',
    lines: [{ productId: p.id, variantId: v.id, slug: p.slug, title: p.title, brandName: p.brandName, image: p.images[0], options: v.options, unitPrice: v.price, quantity: 2, maxQuantity: 10, lineTotal: money(v.price.amount * 2), taxIncluded: money(0) }],
    totals: { itemCount: 2, subtotal: money(v.price.amount * 2), mrpSavings: money(0), couponDiscount: money(0), shipping: money(0), taxIncluded: money(0), total: money(v.price.amount * 2) },
    shippingMethod: 'standard',
    contact: { name: demo.name, email: demo.email, phone: '9876543210' },
    address: { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    timeline: [
      { status: 'placed', label: 'Order placed', at: confirmedAt },
      { status: 'confirmed', label: 'Order confirmed', at: confirmedAt },
    ],
    createdAt: confirmedAt,
    userId: demo.id,
  };
  injector.get(MockOrderStore).save(order);
  return order;
}

/** Opens `path` (with `{order}` replaced by a delivered order's id) as the signed-in demo customer. */
async function openWithOrder(path: string, daysAgo = 1) {
  let order!: Order;
  const page = await openSignedIn(path.replace('{order}', `ORD-UI${daysAgo}`), async (injector) => {
    order = await deliveredOrder(injector, daysAgo);
  });
  await page.settle(15);
  return { page, order };
}

describe('returns and support pages', () => {
  it('requires sign in', async () => {
    const page = await open('/account/returns');
    await page.settle();
    expect(page.url()).toContain('/account/login');
    await page.go('/account/support');
    expect(page.url()).toContain('/account/login');
  });

  it('lets a customer request a return, seeing the refund first, and follow it', async () => {
    const { page, order } = await openWithOrder('/account/returns/new?order={order}');
    let main = page.main();
    expect(text(main)).toContain('Return items');
    expect(await violations(page.root())).toEqual([]);

    // Nothing chosen yet: the form says so instead of submitting.
    await click(button(main, 'Request return'));
    await page.settle();
    expect(main.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);

    const quantity = main.querySelector<HTMLSelectElement>('ul select') as HTMLSelectElement;
    expect(Array.from(quantity.options).map((o) => o.value)).toEqual(['0', '1', '2']);
    await act(async () => {
      fireEvent.change(quantity, { target: { value: '2' } });
      fireEvent.change(field(main, 'Why are you returning it?'), { target: { value: 'changed_mind' } });
    });
    await page.settle();
    expect(text(main)).toContain('Return shipping fee');
    expect(text(main)).toContain('store credit');
    expect(await violations(page.root())).toEqual([]);

    await click(button(main, 'Request return'));
    await page.settle(20);
    expect(page.url()).toMatch(/^\/account\/returns\/RET-/);
    main = page.main();
    expect(text(main)).toContain('Return requested');
    expect(text(main)).toContain('Withdraw request');
    expect(await violations(page.root())).toEqual([]);

    await page.go('/account/returns');
    main = page.main();
    expect(text(main)).toContain(order.id);
    expect(text(main)).toContain('Requested');
    expect(await violations(page.root())).toEqual([]);

    // The same items can't be requested again while that request is open.
    await page.go(`/account/returns/new?order=${order.id}`);
    expect(text(page.main())).toContain("can't be returned right now");
  }, 40000);

  it('explains why an order outside the window cannot be returned', async () => {
    const { page } = await openWithOrder('/account/returns/new?order={order}', 12);
    expect(text(page.main())).toContain('7-day return window ended');
    expect(await violations(page.root())).toEqual([]);
  });

  it("shows 'not found' for an order that isn't theirs", async () => {
    const page = await openSignedIn('/account/returns/new?order=ORD-NOPE');
    await page.settle(15);
    expect(text(page.main())).toContain('could not find');
  });

  it('rejects an unsupported attachment type on the spot', async () => {
    const { page } = await openWithOrder('/account/returns/new?order={order}');
    const main = page.main();
    const input = main.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'virus.exe', { type: 'application/x-msdownload' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await page.settle(3);
    expect(text(main)).toContain('only JPEG, PNG, WebP or PDF');
  });

  it('asks a support question, lists it, and replies on the ticket', async () => {
    const { page, order } = await openWithOrder('/account/support/new?order={order}');
    let main = page.main();
    expect(main.querySelector<HTMLSelectElement>('select')?.value).toBe(order.id);
    expect(await violations(page.root())).toEqual([]);

    await click(button(main, 'Send'));
    await page.settle();
    expect(text(main)).toContain('Add a short subject');
    await fill(main, 'Subject', 'Box was damaged');
    await fill(main, 'Your message', 'The outer box was crushed.');
    await click(button(main, 'Send'));
    await page.settle(20);
    expect(page.url()).toMatch(/^\/account\/support\/TKT-/);
    main = page.main();
    expect(text(main)).toContain('Box was damaged');
    expect(text(main)).toContain('The outer box was crushed.');
    expect(await violations(page.root())).toEqual([]);

    await fill(main, 'Reply', 'Any update?');
    await click(button(main, 'Send reply'));
    await page.settle(20);
    expect(text(page.main())).toContain('Any update?');

    await page.go('/account/support');
    main = page.main();
    expect(text(main)).toContain('Box was damaged');
    expect(await violations(page.root())).toEqual([]);
  }, 40000);
});
