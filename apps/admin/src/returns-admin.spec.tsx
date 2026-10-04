import { act, fireEvent } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import type { Order } from '@ecom/contracts';
import { AuthApi, MockInventoryStore, MockOrderStore, ReturnApi, SupportApi, loadCatalogData } from '@shop/data-access';
import { button, click, fill, fillSelector, violations } from '@shop/ui/testing';
import { admin, customer, setup } from './test-harness';

const DAY = 86_400_000;
const text = (root: HTMLElement) => root.textContent ?? '';

type Out = Awaited<ReturnType<typeof setup>>;

/** Saves a delivered order for the demo customer and has them request a return for 1 unit; returns the ids. */
async function customerRequestsReturn(out: Out) {
  const authApi = out.injector.get(AuthApi);
  await firstValueFrom(authApi.login(customer.email, customer.password));
  const { products } = await loadCatalogData();
  const p = products.find((x) => x.variants[0].stock > 10) as (typeof products)[number];
  const v = p.variants[0];
  const confirmedAt = new Date(Date.now() - DAY - 6 * 60_000).toISOString();
  const money = (amount: number) => ({ amount, currency: 'INR' as const });
  const order: Order = {
    id: 'ORD-ADMIN1',
    status: 'delivered',
    paymentStatus: 'cod',
    paymentMethod: 'cod',
    lines: [{ productId: p.id, variantId: v.id, slug: p.slug, title: p.title, brandName: p.brandName, image: p.images[0], options: v.options, unitPrice: v.price, quantity: 1, maxQuantity: 10, lineTotal: v.price, taxIncluded: money(0) }],
    totals: { itemCount: 1, subtotal: v.price, mrpSavings: money(0), couponDiscount: money(0), shipping: money(0), taxIncluded: money(0), total: v.price },
    shippingMethod: 'standard',
    contact: { name: customer.name, email: customer.email, phone: '9876543210' },
    address: { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    timeline: [
      { status: 'placed', label: 'Order placed', at: confirmedAt },
      { status: 'confirmed', label: 'Order confirmed', at: confirmedAt },
    ],
    createdAt: confirmedAt,
    userId: customer.id,
  };
  out.injector.get(MockOrderStore).save(order);
  const ret = await firstValueFrom(out.injector.get(ReturnApi).create({ orderId: order.id, items: [{ variantId: v.id, quantity: 1 }], reason: 'defective', comments: 'Does not switch on', attachments: [] }));
  await firstValueFrom(authApi.logout());
  return { order, ret, variantId: v.id, title: p.title };
}

describe('admin returns and support', () => {
  it('keeps staff pages away from customers and shows them to staff with their own nav entries', async () => {
    const out = await setup('none');
    await out.auth.login(customer.email, customer.password);
    await out.go('/returns');
    expect(out.url()).toContain('/login');
    await out.auth.logout();
    await out.auth.login(admin.email, admin.password);
    await out.go('/returns');
    expect(out.url()).toBe('/returns/queue');
    expect(text(out.root())).toContain('Returns and refunds');
    expect(await violations(out.root())).toEqual([]);
  });

  it('takes a return from requested to refunded, restocking the item', async () => {
    const out = await setup('none');
    const { ret, variantId } = await customerRequestsReturn(out);
    await out.auth.login(admin.email, admin.password);
    const restocked = () => out.injector.get(MockInventoryStore).movements().filter((m) => m.variantId === variantId && m.kind === 'return').length;

    await out.go('/returns/queue', 12);
    let root = out.root();
    expect(text(root)).toContain(ret.id);
    expect(text(root)).toContain('Requested');
    expect(await violations(root)).toEqual([]);

    await out.go(`/returns/queue/${ret.id}`, 12);
    root = out.root();
    expect(text(root)).toContain('Refund (computed)');
    expect(text(root)).toContain('Does not switch on');
    expect(await violations(root)).toEqual([]);

    // A missing pickup date is refused beside the field.
    await fillSelector(root, 'input[type="date"]', '');
    await click(button(root, 'Approve and schedule pickup'));
    await out.settle();
    expect(text(root)).toContain('Choose a pickup date');

    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    await fillSelector(root, 'input[type="date"]', tomorrow);
    await click(button(root, 'Approve and schedule pickup'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Approved');
    await click(button(root, 'Mark as picked up'));
    await out.settle(15);

    root = out.root();
    expect(await violations(root)).toEqual([]);
    // Passing the check needs a decision for each item and a note.
    await click(button(root, 'Passed: record check'));
    await out.settle();
    expect(text(root)).toContain('Describe what you found');
    await fillSelector(root, 'textarea', 'Tested, works');
    await click(button(root, 'Passed: record check'));
    await out.settle();
    expect(text(root)).toContain('Decide for');
    expect(restocked()).toBe(0); // a refused check changes nothing
    await act(async () => {
      fireEvent.change(root.querySelector('fieldset select') as HTMLSelectElement, { target: { value: 'restock' } });
    });
    await click(button(root, 'Passed: record check'));
    await out.settle(15);
    expect(restocked()).toBe(1);

    root = out.root();
    await click(button(root, 'Issue refund'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Refunded');
    expect(await violations(root)).toEqual([]);

    const authApi = out.injector.get(AuthApi);
    await firstValueFrom(authApi.logout());
    await firstValueFrom(authApi.login(customer.email, customer.password));
    expect((await firstValueFrom(out.injector.get(ReturnApi).get(ret.id))).status).toBe('refunded');
  }, 60000);

  it('rejects a request with a reason', async () => {
    const out = await setup('none');
    const { ret } = await customerRequestsReturn(out);
    await out.auth.login(admin.email, admin.password);
    await out.go(`/returns/queue/${ret.id}`, 12);
    const root = out.root();
    await click(button(root, 'Reject request'));
    await out.settle();
    expect(text(root)).toContain('Give a reason');
    await fillSelector(root, 'textarea', 'Outside our policy for this item');
    await click(button(root, 'Reject request'));
    await out.settle(15);
    expect(text(out.root())).toContain('Rejected: Outside our policy for this item');
  });

  it('saves the return policy and shows validation', async () => {
    const out = await setup('none');
    await out.auth.login(admin.email, admin.password);
    await out.go('/returns/policy', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);
    await fillSelector(root, 'input[type="number"]', '200');
    await click(button(root, 'Save policy'));
    await out.settle();
    expect(text(root)).toContain('0 to 90');
    await fillSelector(root, 'input[type="number"]', '10');
    await click(button(root, 'Save policy'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Last changed');
  });

  it('answers a support ticket and manages assignment and status', async () => {
    const out = await setup('none');
    await firstValueFrom(out.injector.get(AuthApi).login(customer.email, customer.password));
    const ticket = await firstValueFrom(out.injector.get(SupportApi).create({ subject: 'Wrong colour', message: 'I got blue, not black.', attachments: [] }));
    await firstValueFrom(out.injector.get(AuthApi).logout());
    await out.auth.login(admin.email, admin.password);

    await out.go('/support', 12);
    let root = out.root();
    expect(text(root)).toContain('Wrong colour');
    expect(text(root)).toContain('Unassigned');
    expect(await violations(root)).toEqual([]);

    await out.go(`/support/${ticket.id}`, 12);
    root = out.root();
    expect(text(root)).toContain('I got blue, not black.');
    expect(await violations(root)).toEqual([]);
    await fill(root, 'Reply to the customer', 'Sorry about that, a replacement is on the way.');
    await click(button(root, 'Send reply'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('a replacement is on the way');
    expect(text(root)).toContain('Waiting for customer');
    expect(text(root)).toContain(`Assigned to ${admin.name}`);

    await click(button(root, 'Close ticket'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Closed');
    expect(button(root, 'Send reply')).toBeUndefined();
    expect(button(root, 'Reopen')).toBeDefined();
  });
});
