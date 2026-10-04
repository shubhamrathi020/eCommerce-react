import { act, fireEvent } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import { STORAGE } from '@shop/core';
import { CartApi, OrderApi, loadCatalogData } from '@shop/data-access';
import { button, click, fill, fillSelector, violations } from '@shop/ui/testing';
import { customer, seller, setup } from './test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';

describe('seller portal', () => {
  it('sends signed-out visitors to sign in and shows the seller their day after they do', async () => {
    const out = await setup('none', '/products');
    await out.settle();
    expect(out.url()).toContain('/login');
    let root = out.root();
    expect(await violations(root)).toEqual([]);
    await fillSelector(root, 'input[type="email"]', seller.email);
    await fillSelector(root, 'input[type="password"]', 'wrong');
    await click(button(root, 'Sign in'));
    await out.settle(15);
    expect(text(root)).toContain('Incorrect email or password.');
    await fillSelector(root, 'input[type="password"]', seller.password);
    await click(button(root, 'Sign in'));
    await out.settle(25);
    expect(out.url()).toBe('/products'); // back to where they were headed
    await out.go('/');
    root = out.root();
    expect(text(root)).toContain('Urban Threads');
    expect(text(root)).toContain('Live listings');
    expect(text(root)).toContain('Awaiting approval');
    expect(await violations(root)).toEqual([]);
  });

  it('keeps a customer who has not applied out of the working pages and invites them to apply', async () => {
    const out = await setup('customer', '/products');
    await out.settle();
    expect(out.url()).toBe('/'); // the permission guard sent them back
    expect(text(out.root())).toContain('Start selling');
    expect(Array.from(out.root().querySelectorAll('nav a')).map((a) => a.textContent?.trim())).toEqual(['Overview']);
  });

  it('takes a new seller through applying, with field errors, then shows the review state', async () => {
    const out = await setup('none');
    await out.auth.register({ name: 'Lamp Lane', email: 'lamp@example.com', password: 'Lamp@1234' });
    await out.go('/apply', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Submit application'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Enter a valid 15-character GSTIN');
    expect(text(root)).toContain('Enter a valid 10-character PAN');

    const values: Record<string, string> = {
      'Store name': 'Lamp Lane',
      'Legal business name': 'Lamp Lane Traders',
      'Mobile number': '9811111111',
      GSTIN: '27AAAPL1234C1ZV',
      PAN: 'AAAPL1234C',
      Address: '9 Lamp Lane',
      City: 'Pune',
      State: 'Maharashtra',
      'Pin code': '411001',
      'Account holder name': 'Lamp Lane Traders',
      'Account number': '123456789012',
      'IFSC code': 'HDFC0001234',
      'Returns policy': '7-day returns',
      'Shipping policy': 'Ships in 2 days',
    };
    for (const [label, value] of Object.entries(values)) await fill(root, label, value);
    await click(button(root, 'Submit application'));
    await out.settle(25);
    root = out.root();
    expect(out.url()).toBe('/');
    expect(text(root)).toContain('Lamp Lane');
    expect(text(root)).toContain('Awaiting review');
    expect(text(root)).toContain('being reviewed');
    expect(out.injector.get(STORAGE).getItem('ecom.mock.sellers.v1')).not.toContain('123456789012');
  });

  it("lists the seller's products, validates a new one, and sends a draft for approval", async () => {
    const out = await setup('seller');
    await out.go('/products', 12);
    let root = out.root();
    expect(text(root)).toContain('Handloom Cotton Kurta');
    expect(text(root)).toContain('Block-Print Cotton Dupatta');
    expect(text(root)).toContain('Awaiting approval');
    expect(text(root)).toContain('Items the store assigned to you');
    expect(await violations(root)).toEqual([]);

    await out.go('/products/new', 12);
    root = out.root();
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Save'));
    await out.settle(15);
    expect(text(out.root())).toContain('Give the product a title');

    await fill(root, 'Title', 'Brass Diya Set');
    await fill(root, 'Brand', 'Urban Threads');
    await fill(root, 'Description', 'Hand-cast brass diyas.');
    await fill(root, 'Price', '599');
    await fill(root, 'Units in stock', '12');
    const category = root.querySelector<HTMLSelectElement>('main select') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(category, { target: { value: Array.from(category.options).find((o) => o.textContent?.includes('Home Decor'))?.value ?? '' } });
    });
    await click(button(root, 'Save'));
    await out.settle(25);
    expect(out.url()).toBe('/products');
    root = out.root();
    expect(text(root)).toContain('Brass Diya Set');
    expect(text(root)).toContain('Draft');

    await click(button(root, 'Submit Brass Diya Set for approval'));
    await out.settle(15);
    expect(text(out.root())).toContain('Brass Diya Set');
    expect(Array.from(out.root().querySelectorAll('li')).find((li) => li.textContent?.includes('Brass Diya Set'))?.textContent).toContain('Awaiting approval');
  });

  it('shows a seller only their part of an order and moves it to delivered', async () => {
    const out = await setup('none');
    const { products } = await loadCatalogData();
    const variantOf = (id: string) => products.find((p) => p.id === id)?.variants[0].id as string;
    await out.auth.login(customer.email, customer.password);
    await firstValueFrom(out.injector.get(CartApi).add(variantOf('p-0010'), 1));
    await firstValueFrom(out.injector.get(CartApi).add(variantOf('p-0100'), 1));
    await firstValueFrom(
      out.injector.get(OrderApi).place({ idempotencyKey: 'k-ui', contact: { name: 'Asha Rao', email: customer.email, phone: '9876543210' }, address: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, paymentMethod: 'cod' }),
    );
    await out.auth.logout();
    await out.auth.login(seller.email, seller.password);

    await out.go('/orders', 12);
    let root = out.root();
    expect(root.querySelectorAll('main > ul > li, ul.space-y-4 > li')).toHaveLength(1);
    expect(text(root)).toContain('Asha Rao');
    expect(text(root)).toContain('560001');
    expect(text(root)).not.toContain(customer.email);
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Mark as packed'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Packed');
    await click(button(root, 'Mark as shipped'));
    await out.settle(15);
    expect(text(out.root())).toContain('Enter a valid tracking number');
    await fill(root, 'Courier tracking number', 'DLV123456');
    await click(button(root, 'Mark as shipped'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('DLV123456');
    await click(button(root, 'Mark as delivered'));
    await out.settle(15);
    expect(text(out.root())).toContain('Delivered');
    expect(button(out.root(), 'Mark as')).toBeUndefined();

    await out.go('/payouts', 12);
    root = out.root();
    expect(text(root)).toContain('Not yet on a statement');
    expect(text(root)).toMatch(/delivered .*less \d+(\.\d+)?% commission/);
    expect(text(root)).toContain('No statements have been issued to you yet.');
    expect(await violations(root)).toEqual([]);
  });
});
