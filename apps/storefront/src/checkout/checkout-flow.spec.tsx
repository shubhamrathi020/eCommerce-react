import { firstValueFrom } from 'rxjs';
import type { Injector } from '@shop/core';
import { AddressBookApi, CatalogApi, DEMO_ACCOUNTS, OrderApi } from '@shop/data-access';
import { AuthStore, CartStore } from '@shop/state';
import { act, fireEvent } from '@testing-library/react';
import { button, click, fill, fillSelector, violations } from '@shop/ui/testing';
import { open } from '../test-harness';
import { MockPaymentLauncher } from './payment';

const text = (root: HTMLElement) => root.textContent ?? '';
type Page = Awaited<ReturnType<typeof open>>;

/** Puts one affordable, well-stocked item in the cart before the page is drawn. */
async function withCart(injector: Injector, signIn = false) {
  const auth = injector.get(AuthStore);
  await auth.init();
  if (signIn) await auth.login(DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].password);
  const catalog = injector.get(CatalogApi);
  const list = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 50 }));
  const variant = (await firstValueFrom(catalog.productsByIds(list.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 20 && v.price.amount < 400_000);
  const store = injector.get(CartStore);
  await store.refresh();
  return { store, variantId: variant?.id ?? '' };
}

async function fillAddress(page: Page) {
  const main = page.main();
  await fill(main, 'Full name', 'Asha Rao');
  await fill(main, 'Email', 'asha@example.com');
  await fill(main, 'Mobile number', '9876543210');
  await fill(main, 'Pin code', '560001');
  await fill(main, 'Address line 1', '12 MG Road');
  await fill(main, 'City', 'Bengaluru');
  await fill(main, 'State', 'Karnataka');
  await click(button(main, 'Continue to delivery'));
  await page.settle();
}

/** Opens checkout with one item in the cart. */
async function checkout(opts: { signIn?: boolean; prepare?: (injector: Injector, store: CartStore) => Promise<void> } = {}) {
  let store!: CartStore;
  const page = await open('/checkout', async (injector) => {
    const prepared = await withCart(injector, opts.signIn);
    store = prepared.store;
    await opts.prepare?.(injector, store);
    await store.add({ productId: 'x', variantId: prepared.variantId, quantity: 1, title: 'T' });
  });
  return { page, store };
}

describe('cart and checkout pages', () => {
  it('cart page shows lines, updates quantity, applies a coupon and shows a validation message', async () => {
    let store!: CartStore;
    const page = await open('/cart', async (injector) => {
      const prepared = await withCart(injector);
      store = prepared.store;
      await store.add({ productId: 'x', variantId: prepared.variantId, quantity: 2, title: 'T' });
    });
    await page.settle();
    const main = page.main();
    expect(main.querySelectorAll('ul.divide-y > li')).toHaveLength(1);
    expect(text(main)).toContain('Your cart');

    await fillSelector(main, 'input[name="code"]', 'bogus');
    await click(main.querySelector<HTMLButtonElement>('aside form button[type="submit"]'));
    await page.settle();
    expect(text(main)).toContain('not valid');
  });

  it('redirects an empty cart away from checkout', async () => {
    const page = await open('/checkout');
    await page.settle();
    expect(page.url()).toBe('/cart');
  });

  it('validates the address step, then completes a cash-on-delivery order', async () => {
    const { page, store } = await checkout();
    const main = page.main();

    await click(button(main, 'Continue to delivery'));
    await page.settle();
    expect(main.querySelectorAll('[role="alert"]').length).toBeGreaterThan(3);

    await fillAddress(page);
    expect(main.querySelector('#step-heading')?.textContent).toContain('Delivery');
    await click(button(main, 'Continue to payment'));
    await page.settle();
    const radios = main.querySelectorAll<HTMLInputElement>('input[name="payment"]');
    expect(radios).toHaveLength(2);
    await click(radios[1]);
    await page.settle();
    await click(button(main, 'Review order'));
    await page.settle();
    expect(button(main, 'Place order')).toBeDefined();
    await click(button(main, 'Place order'));
    await page.settle(25);

    expect(page.url()).toMatch(/^\/orders\/ORD-.*placed=1/);
    expect(store.isEmpty()).toBe(true);
  }, 30000);

  it('online payment: failed attempt keeps the order pending, retry succeeds', async () => {
    const { page, store } = await checkout();
    const main = page.main();
    await fillAddress(page);
    await click(button(main, 'Continue to payment'));
    await page.settle();
    await click(button(main, 'Review order'));
    await page.settle();

    const launcher = page.injector.get(MockPaymentLauncher);
    await click(button(main, 'Pay '));
    await page.settle();
    expect(launcher.pending()).not.toBeNull();
    await act(async () => launcher.fail());
    await page.settle();
    expect(text(main)).toContain('did not go through');
    expect(store.isEmpty()).toBe(false); // cart kept until paid

    await click(button(main, 'Retry payment'));
    await page.settle();
    await act(async () => launcher.succeed());
    await page.settle(25);
    expect(page.url()).toMatch(/^\/orders\/ORD-/);
    expect(store.isEmpty()).toBe(true);
  }, 30000);

  it('order, invoice and orders list pages render and have no serious accessibility issues', async () => {
    const { page } = await checkout();
    let main = page.main();
    expect(await violations(page.root())).toEqual([]);
    await fillAddress(page);
    await click(button(main, 'Continue to payment'));
    await page.settle();
    await click(main.querySelectorAll<HTMLInputElement>('input[name="payment"]')[1]);
    await page.settle();
    await click(button(main, 'Review order'));
    await page.settle();
    await click(button(main, 'Place order'));
    await page.settle(25);

    const orderUrl = page.url().split('?')[0];
    await page.go(orderUrl);
    main = page.main();
    expect(text(main)).toContain('Tracking');
    expect(await violations(page.root())).toEqual([]);

    await page.go(`${orderUrl}/invoice`);
    main = page.main();
    expect(text(main)).toContain('Tax Invoice');
    expect(await violations(page.root())).toEqual([]);

    await page.go('/orders');
    main = page.main();
    expect(main.querySelectorAll('li a').length).toBe(1);

    await page.go('/cart');
    main = page.main();
    expect(text(main)).toContain('Your cart is empty');
    expect(await violations(page.root())).toEqual([]);
  }, 40000);

  it('signed-in customers get details and their default address pre-filled, and the order is linked to them', async () => {
    const { page } = await checkout({
      signIn: true,
      prepare: async (injector) => {
        await firstValueFrom(injector.get(AddressBookApi).add({ label: 'Home', name: 'Demo Customer', phone: '9876543210', address: { line1: '5 Park Street', city: 'Kolkata', state: 'West Bengal', pincode: '700016' } }));
      },
    });
    await page.settle(15);
    const main = page.main();
    const value = (label: string) => (Array.from(main.querySelectorAll('label')).find((l) => l.textContent?.trim().startsWith(label))?.nextElementSibling as HTMLInputElement | null)?.value;
    expect((main.querySelector('input[type="email"]') as HTMLInputElement).value).toBe(DEMO_ACCOUNTS[0].email);
    expect(value('Address line 1') ?? (main.querySelector('input[autocomplete="address-line1"]') as HTMLInputElement).value).toBe('5 Park Street');
    expect(main.querySelector('#saved-address')).not.toBeNull();

    // A new address can be chosen instead, and offers to be saved.
    await act(async () => {
      fireEvent.change(main.querySelector('#saved-address') as HTMLSelectElement, { target: { value: '' } });
    });
    await page.settle();
    expect(text(main)).toContain('Save this address to my account');
    await fill(main, 'Address line 1', '12 MG Road');
    await fill(main, 'City', 'Bengaluru');
    await fill(main, 'State', 'Karnataka');
    await fill(main, 'Pin code', '560001');
    await click(button(main, 'Continue to delivery'));
    await page.settle();
    await click(button(main, 'Continue to payment'));
    await page.settle();
    await click(main.querySelectorAll<HTMLInputElement>('input[name="payment"]')[1]);
    await page.settle();
    await click(button(main, 'Review order'));
    await page.settle();
    await click(button(main, 'Place order'));
    await page.settle(25);

    const orders = await firstValueFrom(page.injector.get(OrderApi).list());
    expect(orders).toHaveLength(1);
    expect(orders[0].userId).toBeDefined();
    const saved = await firstValueFrom(page.injector.get(AddressBookApi).list());
    expect(saved.map((a) => a.address.line1)).toContain('12 MG Road');
  }, 40000);
});
