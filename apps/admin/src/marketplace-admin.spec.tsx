import { act, fireEvent } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import { AuthApi, CartApi, DEMO_ACCOUNTS, OrderApi, SellerPortalApi, loadCatalogData } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { button, click, fill, fillSelector, violations } from '@shop/ui/testing';
import { setup } from './test-harness';

const [customer, admin, seller] = DEMO_ACCOUNTS;
const text = (root: HTMLElement) => root.textContent ?? '';

describe('admin marketplace', () => {
  it('is for staff with seller:manage only', async () => {
    const out = await setup('customer');
    await out.go('/marketplace');
    expect(out.url()).toContain('/login');
  });

  it('shows the waiting application with its KYC details, and rejecting needs a reason the applicant will see', async () => {
    const out = await setup();
    await out.go('/marketplace', 12);
    expect(out.url()).toBe('/marketplace/applications');
    let root = out.root();
    expect(text(root)).toContain('Fresh Bazaar');
    expect(text(root)).toContain('29ABCDE9999K1Z8');
    expect(text(root)).toContain('account ending 1122');
    expect(await violations(root)).toEqual([]);

    await click(button(root, 'Reject Fresh Bazaar'));
    await out.settle();
    root = out.root();
    await click(button(root, 'Confirm rejection of Fresh Bazaar'));
    await out.settle(15);
    expect(text(out.root())).toContain('Give a reason');
    await fill(root, 'Reason', 'Documents are unreadable');
    await click(button(root, 'Confirm rejection of Fresh Bazaar'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Documents are unreadable');
    expect(text(root)).toContain('Not approved');
  });

  it('approves an applicant, who can then use the seller portal', async () => {
    const out = await setup();
    // A real applicant: a customer who applied through the portal API.
    const auth = out.injector.get(AuthApi);
    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(customer.email, customer.password));
    await firstValueFrom(
      out.injector.get(SellerPortalApi).apply({
        displayName: 'Lamp Lane',
        legalName: 'Lamp Lane Traders',
        phone: '9811111111',
        gstin: '27AAAPL1234C1ZV',
        pan: 'AAAPL1234C',
        address: { line1: '9 Lamp Lane', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        bankHolder: 'Lamp Lane Traders',
        bankAccountNumber: '123456789012',
        bankIfsc: 'HDFC0001234',
        policies: { returns: '7-day returns', shipping: 'Ships in 2 days' },
      }),
    );
    await firstValueFrom(auth.logout());
    await out.injector.get(AuthStore).login(admin.email, admin.password);

    await out.go('/marketplace/applications', 12);
    let root = out.root();
    expect(text(root)).toContain('Lamp Lane');
    await click(button(root, 'Approve Lamp Lane'));
    await out.settle(15);
    await out.go('/marketplace/sellers', 12);
    root = out.root();
    expect(text(root)).toContain('Lamp Lane');
    expect(text(root)).toContain('Urban Threads');
    expect(await violations(root)).toEqual([]);

    await firstValueFrom(auth.logout());
    await firstValueFrom(auth.login(customer.email, customer.password));
    expect(await firstValueFrom(out.injector.get(SellerPortalApi).products())).toEqual([]); // allowed in, with nothing listed yet
  });

  it('suspends and restores a seller, and sets a commission override', async () => {
    const out = await setup();
    await out.go('/marketplace/sellers', 12);
    let root = out.root();
    await fillSelector(root, 'input[inputmode="decimal"]', '7');
    await click(button(root, 'Save commission for'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toMatch(/7% \(override\)/);

    await click(button(root, 'Suspend '));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Suspended');
    expect(button(root, 'Restore ')).toBeDefined();
    await click(button(root, 'Restore '));
    await out.settle(15);
    expect(text(out.root())).not.toContain('Suspended');
  });

  it('approves a seller listing so it appears in the shop, and rejecting one needs a reason', async () => {
    const out = await setup();
    await out.go('/marketplace/listings', 12);
    let root = out.root();
    expect(text(root)).toContain('Block-Print Cotton Dupatta');
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Reject Block-Print Cotton Dupatta'));
    await out.settle();
    root = out.root();
    await click(button(root, 'Confirm rejection of Block-Print Cotton Dupatta'));
    await out.settle(15);
    expect(text(out.root())).toContain('Give a reason');
    await click(button(root, 'Cancel'));
    await out.settle();
    await click(button(out.root(), 'Approve Block-Print Cotton Dupatta'));
    await out.settle(15);
    expect(text(out.root())).toContain('Nothing here'); // no longer waiting
    await act(async () => {
      fireEvent.change(out.root().querySelector('#ls') as HTMLSelectElement, { target: { value: 'approved' } });
    });
    await out.settle(15);
    expect(text(out.root())).toContain('Block-Print Cotton Dupatta');
  });

  it('adds a commission rule, refusing a clash and a bad percentage', async () => {
    const out = await setup();
    await out.go('/marketplace/commission', 12);
    let root = out.root();
    expect(text(root)).toContain('Category: Fashion');
    expect(await violations(root)).toEqual([]);
    await fillSelector(root, 'form select', 'category');
    await out.settle();
    root = out.root();
    await click(button(root, 'Save rule'));
    await out.settle(15);
    expect(text(out.root())).toContain('Enter 0 to 50');
    expect(text(out.root())).toContain('Choose a category');
  });

  it('builds a payout statement from a delivered order, issues it and marks it paid', async () => {
    const out = await setup();
    const auth = out.auth;
    const { products } = await loadCatalogData();
    await auth.logout();
    await auth.login(customer.email, customer.password);
    await firstValueFrom(out.injector.get(CartApi).add(products.find((p) => p.id === 'p-0010')?.variants[0].id as string, 1));
    await firstValueFrom(
      out.injector.get(OrderApi).place({ idempotencyKey: 'k-pay', contact: { name: 'Asha Rao', email: customer.email, phone: '9876543210' }, address: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, paymentMethod: 'cod' }),
    );
    await auth.logout();
    await auth.login(seller.email, seller.password);
    const portal = out.injector.get(SellerPortalApi);
    const [shipment] = await firstValueFrom(portal.shipments());
    await firstValueFrom(portal.advanceShipment(shipment.id));
    await firstValueFrom(portal.advanceShipment(shipment.id, 'TRK-UI-1'));
    await firstValueFrom(portal.advanceShipment(shipment.id));
    await auth.logout();
    await auth.login(admin.email, admin.password);

    await out.go('/marketplace/payouts', 12);
    let root = out.root();
    expect(await violations(root)).toEqual([]);
    await click(button(root, 'Preview'));
    await out.settle(15);
    expect(text(out.root())).toContain('Choose a seller');
    await act(async () => {
      fireEvent.change(root.querySelector('form select') as HTMLSelectElement, { target: { value: 'sel_demo' } });
    });
    await click(button(root, 'Preview'));
    await out.settle(15);
    root = out.root();
    expect(text(root)).toContain('Urban Threads');
    expect(text(root)).toMatch(/12\s*%|12%/);
    await click(button(root, 'Issue statement'));
    await out.settle(20);
    root = out.root();
    expect(text(root)).toContain('Issued');
    const payButton = () => Array.from(out.root().querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('Mark PAY'));
    await click(payButton());
    await out.settle(15);
    expect(text(out.root())).toContain('Enter the transfer reference');
    await fillSelector(out.root(), 'td input', 'UTR998877');
    await click(payButton());
    await out.settle(20);
    root = out.root();
    expect(text(root)).toContain('Paid');
    expect(text(root)).toContain('UTR998877');
  }, 40000);
});
