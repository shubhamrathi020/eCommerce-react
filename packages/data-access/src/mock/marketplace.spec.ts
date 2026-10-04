import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { Order, Product, SellerApplicationInput } from '@ecom/contracts';
import { commissionPercent, orderStatusFromShipments, sellerApplicationProblems, sellerProductProblems, sellerRating, splitCommission, statementTotals } from '@ecom/contracts';
import {
  AdminReturnApi,
  AdminSellerApi,
  AuditApi,
  AuthApi,
  CartApi,
  CatalogApi,
  DEMO_ACCOUNTS,
  MockOrderStore,
  OrderApi,
  ReturnApi,
  SellerPortalApi,
  SellerPublicApi,
  loadCatalogData,
  provideAdminDataAccess,
  provideDataAccess,
} from '../index';

const [customer, admin, seller] = DEMO_ACCOUNTS;

describe('marketplace rules (pure)', () => {
  const application: SellerApplicationInput = {
    displayName: 'Test Store',
    legalName: 'Test Traders',
    phone: '9876543210',
    gstin: '27AAAPL1234C1ZV',
    pan: 'AAAPL1234C',
    address: { line1: '1 Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    bankHolder: 'Test Traders',
    bankAccountNumber: '123456789012',
    bankIfsc: 'HDFC0001234',
    policies: { returns: '7 days', shipping: '2 days' },
  };

  it('checks KYC fields and accepts lower-case identifiers', () => {
    expect(sellerApplicationProblems(application)).toEqual({});
    expect(sellerApplicationProblems({ ...application, gstin: ' 27aaapl1234c1zv ', pan: 'aaapl1234c', bankIfsc: 'hdfc0001234' })).toEqual({});
    const bad = sellerApplicationProblems({ ...application, displayName: '', phone: '123', gstin: 'X', pan: 'X', bankAccountNumber: '12', bankIfsc: 'X', address: { ...application.address, pincode: '1' } });
    expect(Object.keys(bad).sort()).toEqual(['address.pincode', 'bankAccountNumber', 'bankIfsc', 'displayName', 'gstin', 'pan', 'phone']);
  });

  it('checks a seller product', () => {
    const ok = { title: 'Mug', brandName: 'B', categoryId: 'c', description: 'd', price: 10000, stock: 5 };
    expect(sellerProductProblems(ok, () => true)).toEqual({});
    expect(Object.keys(sellerProductProblems({ ...ok, title: '', price: 5, mrp: 4, stock: -1 }, () => false)).sort()).toEqual(['categoryId', 'mrp', 'price', 'stock', 'title']);
  });

  it('picks the most specific commission and rounds it down to a whole paisa', () => {
    const rules = [
      { id: 'd', scope: 'default' as const, percent: 10 },
      { id: 'c', scope: 'category' as const, categoryId: 'cat-fashion', percent: 12 },
      { id: 'l', scope: 'category' as const, categoryId: 'cat-men-clothing', percent: 15 },
      { id: 's', scope: 'seller' as const, sellerId: 's1', percent: 7 },
    ];
    const path = ['cat-fashion', 'cat-men-clothing'];
    expect(commissionPercent(rules, { id: 's2' }, ['cat-books'])).toBe(10);
    expect(commissionPercent(rules, { id: 's2' }, ['cat-fashion'])).toBe(12);
    expect(commissionPercent(rules, { id: 's2' }, path)).toBe(15); // the leaf beats its parent
    expect(commissionPercent(rules, { id: 's1' }, path)).toBe(7); // a rule for the seller beats categories
    expect(commissionPercent(rules, { id: 's1', commissionRate: 3 }, path)).toBe(3); // the seller's own override beats everything
    expect(commissionPercent([], undefined, [])).toBe(10);
    expect(splitCommission(9999, 10)).toEqual({ commission: 999, net: 9000 });
  });

  it('adds up a statement, with returns taking money and commission back', () => {
    const line = { shipmentId: 's', orderId: 'o', deliveredAt: 'x', gross: 10000, percent: 10, commission: 1000, net: 9000 };
    const adj = { returnId: 'r', orderId: 'o', refundedAt: 'x', gross: -4000, percent: 10, commission: -400, net: -3600 };
    expect(statementTotals([line], [adj])).toEqual({ gross: 6000, commission: 600, net: 5400 });
  });

  it('says an order is as far along as its slowest live shipment', () => {
    expect(orderStatusFromShipments(['delivered', 'packed'])).toBe('packed');
    expect(orderStatusFromShipments(['delivered', 'cancelled'])).toBe('delivered');
    expect(orderStatusFromShipments(['cancelled', 'cancelled'])).toBe('cancelled');
    expect(orderStatusFromShipments(['shipped', 'shipped'])).toBe('shipped');
  });

  it('rates a seller by the review-weighted mean of their products', () => {
    expect(sellerRating([{ rating: { average: 5, count: 1 } }, { rating: { average: 3, count: 3 } }])).toEqual({ average: 3.5, count: 4 });
    expect(sellerRating([{ rating: { average: 0, count: 0 } }])).toEqual({ average: 0, count: 0 });
  });
});

describe('marketplace (mock)', () => {
  let auth: AuthApi;
  let portal: SellerPortalApi;
  let adminApi: AdminSellerApi;
  let cart: CartApi;
  let orders: OrderApi;
  let catalog: CatalogApi;
  let publicApi: SellerPublicApi;
  let products: Product[];
  let variantOf: (productId: string) => string;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    portal = TestBed.inject(SellerPortalApi);
    adminApi = TestBed.inject(AdminSellerApi);
    cart = TestBed.inject(CartApi);
    orders = TestBed.inject(OrderApi);
    catalog = TestBed.inject(CatalogApi);
    publicApi = TestBed.inject(SellerPublicApi);
    products = (await loadCatalogData()).products;
    variantOf = (id) => (products.find((p) => p.id === id) as Product).variants[0].id;
  });

  const login = (a: { email: string; password: string }) => firstValueFrom(auth.login(a.email, a.password));
  const asSeller = () => login(seller);
  const asAdmin = () => login(admin);
  const asCustomer = () => login(customer);
  const address = { name: customer.name, email: customer.email, phone: '9876543210' };
  const delivery = { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  const checkout = async (...ids: string[]): Promise<Order> => {
    for (const id of ids) await firstValueFrom(cart.add(variantOf(id), 1));
    return firstValueFrom(orders.place({ idempotencyKey: `k-${Math.random()}`, contact: address, address: delivery, paymentMethod: 'cod' }));
  };
  const listing = { title: 'Brass Diya Set', brandName: 'Urban Threads', categoryId: 'cat-home-decor', description: 'Hand-cast brass diyas.', price: 59900, stock: 12 };
  const apply = (over: Partial<SellerApplicationInput> = {}): SellerApplicationInput => ({
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
    ...over,
  });

  describe('applying and approval (MP-01)', () => {
    it('lets anyone signed in apply, refuses a bad application with field messages, and stores only the last four bank digits', async () => {
      await expect(firstValueFrom(portal.apply(apply()))).rejects.toMatchObject({ code: 'unauthorized' });
      await asCustomer();
      await expect(firstValueFrom(portal.apply(apply({ gstin: 'nope', pan: 'x' })))).rejects.toMatchObject({ fields: { gstin: expect.any(String), pan: expect.any(String) } });
      const applied = await firstValueFrom(portal.apply(apply()));
      expect(applied).toMatchObject({ status: 'pending', bankAccountLast4: '9012', ownerUserId: customer.id });
      expect(localStorage.getItem('ecom.mock.sellers.v1')).not.toContain('123456789012');
      await expect(firstValueFrom(portal.apply(apply()))).rejects.toMatchObject({ code: 'conflict' });
      expect(await firstValueFrom(portal.me())).toMatchObject({ id: applied.id, status: 'pending' });
    });

    it('keeps a pending applicant out of the portal until an admin approves, then they sign in again and are in', async () => {
      await asCustomer();
      const applied = await firstValueFrom(portal.apply(apply()));
      await expect(firstValueFrom(portal.products())).rejects.toMatchObject({ code: 'forbidden', message: 'Your application is still being reviewed.' });

      await asAdmin();
      expect((await firstValueFrom(adminApi.sellers('pending'))).map((s) => s.id)).toEqual(expect.arrayContaining([applied.id, 'sel_new']));
      const approved = await firstValueFrom(adminApi.decideSeller(applied.id, { approve: true }));
      expect(approved).toMatchObject({ status: 'approved', decidedBy: admin.name });
      await expect(firstValueFrom(adminApi.decideSeller(applied.id, { approve: true }))).rejects.toMatchObject({ code: 'validation' }); // not twice

      await asCustomer(); // a fresh sign in picks up the seller role
      expect((await firstValueFrom(auth.me()))?.user.permissions).toContain('seller:portal');
      expect(await firstValueFrom(portal.products())).toEqual([]);
      const actions = (await firstValueFrom((await asAdmin(), TestBed.inject(AuditApi).list({ page: 1, pageSize: 10 })))).items.map((a) => a.action);
      expect(actions).toContain('seller.approve');
    });

    it('shows a rejected applicant the reason, and lets them apply again', async () => {
      await asCustomer();
      const applied = await firstValueFrom(portal.apply(apply()));
      await asAdmin();
      await expect(firstValueFrom(adminApi.decideSeller(applied.id, { approve: false, reason: ' ' }))).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
      await firstValueFrom(adminApi.decideSeller(applied.id, { approve: false, reason: 'GSTIN does not match the legal name' }));
      await asCustomer();
      expect(await firstValueFrom(portal.me())).toMatchObject({ status: 'rejected', rejectionReason: 'GSTIN does not match the legal name' });
      await expect(firstValueFrom(portal.products())).rejects.toMatchObject({ code: 'forbidden' });
      const again = await firstValueFrom(portal.apply(apply({ legalName: 'Lamp Lane Traders Pvt Ltd' })));
      expect(again).toMatchObject({ id: applied.id, status: 'pending' });
      expect(again.rejectionReason).toBeUndefined();
    });

    it('keeps the admin tools away from sellers and customers', async () => {
      for (const who of [seller, customer]) {
        await login(who);
        await expect(firstValueFrom(adminApi.sellers())).rejects.toMatchObject({ code: 'forbidden' });
        await expect(firstValueFrom(adminApi.decideSeller('sel_new', { approve: true }))).rejects.toMatchObject({ code: 'forbidden' });
      }
    });
  });

  describe('listings and approval (MP-02, MP-06)', () => {
    it('shows a listing on the storefront only once approved, and takes it down when the text changes but not when the price does', async () => {
      await asSeller();
      const draft = await firstValueFrom(portal.saveProduct(listing));
      expect(draft.status).toBe('draft');
      const onShop = async () => (await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 100, q: 'Brass Diya' }))).items.some((i) => i.id === draft.id);
      expect(await onShop()).toBe(false);
      const pending = await firstValueFrom(portal.submitProduct(draft.id));
      expect(pending.status).toBe('pending');
      expect(await onShop()).toBe(false);
      await expect(firstValueFrom(portal.submitProduct(draft.id))).rejects.toMatchObject({ code: 'validation' });

      await asAdmin();
      expect((await firstValueFrom(adminApi.products('pending'))).map((p) => p.id)).toContain(draft.id);
      await firstValueFrom(adminApi.decideProduct(draft.id, { approve: true }));
      expect(await onShop()).toBe(true);
      const live = (await firstValueFrom(catalog.productsByIds([draft.id])))[0];
      expect(live).toMatchObject({ sellerId: 'sel_demo', title: 'Brass Diya Set' });
      expect(live.variants[0]).toMatchObject({ stock: 12, price: { amount: 59900 } });

      await asSeller();
      const repriced = await firstValueFrom(portal.saveProduct({ ...listing, id: draft.id, price: 54900, stock: 20 }));
      expect(repriced.status).toBe('approved');
      expect(await onShop()).toBe(true);
      const retitled = await firstValueFrom(portal.saveProduct({ ...listing, id: draft.id, title: 'Brass Diya Set of Six' }));
      expect(retitled.status).toBe('pending');
      expect(await onShop()).toBe(false);
    });

    it('shows the seller why a listing was rejected, and lets them fix and resubmit it', async () => {
      await asSeller();
      const draft = await firstValueFrom(portal.saveProduct(listing));
      await firstValueFrom(portal.submitProduct(draft.id));
      await asAdmin();
      await expect(firstValueFrom(adminApi.decideProduct(draft.id, { approve: false }))).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
      await firstValueFrom(adminApi.decideProduct(draft.id, { approve: false, reason: 'Photos are missing' }));
      await asSeller();
      const mine = (await firstValueFrom(portal.products())).find((p) => p.id === draft.id);
      expect(mine).toMatchObject({ status: 'rejected', rejectionReason: 'Photos are missing' });
      expect((await firstValueFrom(portal.submitProduct(draft.id))).status).toBe('pending');
    });

    it('validates a listing', async () => {
      await asSeller();
      await expect(firstValueFrom(portal.saveProduct({ ...listing, title: '', price: 1, categoryId: 'cat-fashion' }))).rejects.toMatchObject({ fields: { title: expect.any(String), price: expect.any(String), categoryId: expect.any(String) } });
    });

    it('lets a seller delete only drafts and rejected listings', async () => {
      await asSeller();
      const draft = await firstValueFrom(portal.saveProduct(listing));
      await firstValueFrom(portal.deleteProduct(draft.id));
      expect((await firstValueFrom(portal.products())).some((p) => p.id === draft.id)).toBe(false);
      await expect(firstValueFrom(portal.deleteProduct('sp-0001'))).rejects.toMatchObject({ code: 'validation' }); // live
    });

    it('sets stock to the number entered even after units were sold', async () => {
      await asCustomer();
      await checkout('sp-0001');
      await asSeller();
      await firstValueFrom(portal.setStock('sp-0001', 100));
      expect((await firstValueFrom(catalog.productsByIds(['sp-0001'])))[0].variants[0].stock).toBe(100);
      await expect(firstValueFrom(portal.setStock('sp-0001', -3))).rejects.toMatchObject({ fields: { stock: expect.any(String) } });
    });

    it('suspending a seller takes their listings off sale and locks the portal', async () => {
      await asAdmin();
      await firstValueFrom(adminApi.setStanding('sel_demo', 'suspended'));
      expect((await firstValueFrom(catalog.productsByIds(['sp-0001']))).length).toBe(0);
      expect((await firstValueFrom(catalog.productsByIds(['p-0010'])))[0].variants[0].stock).toBe(0);
      expect(await firstValueFrom(publicApi.profile('sel_demo'))).toBeNull();
      await asSeller();
      await expect(firstValueFrom(portal.products())).rejects.toMatchObject({ message: expect.stringContaining('suspended') });
      await asAdmin();
      await firstValueFrom(adminApi.setStanding('sel_demo', 'approved'));
      expect((await firstValueFrom(catalog.productsByIds(['sp-0001']))).length).toBe(1);
    });
  });

  describe('seller isolation (business rule 1)', () => {
    it('shows each seller only their own data, and another seller\'s ids answer "not found"', async () => {
      // A second approved seller with a listing of their own.
      await asCustomer();
      const applied = await firstValueFrom(portal.apply(apply()));
      await asAdmin();
      await firstValueFrom(adminApi.decideSeller(applied.id, { approve: true }));
      await asCustomer();
      const theirs = await firstValueFrom(portal.saveProduct(listing));
      expect((await firstValueFrom(portal.products())).map((p) => p.id)).toEqual([theirs.id]);

      await asSeller();
      expect((await firstValueFrom(portal.products())).map((p) => p.id)).not.toContain(theirs.id);
      await expect(firstValueFrom(portal.saveProduct({ ...listing, id: theirs.id }))).rejects.toMatchObject({ code: 'not_found' });
      await expect(firstValueFrom(portal.submitProduct(theirs.id))).rejects.toMatchObject({ code: 'not_found' });
      await expect(firstValueFrom(portal.setStock(theirs.id, 5))).rejects.toMatchObject({ code: 'not_found' });
      await expect(firstValueFrom(portal.deleteProduct(theirs.id))).rejects.toMatchObject({ code: 'not_found' });
      expect((await firstValueFrom(portal.me()))?.id).toBe('sel_demo');
    });

    it('is not available to a customer who has not applied', async () => {
      await asCustomer();
      expect(await firstValueFrom(portal.me())).toBeNull();
      for (const call of [() => portal.products(), () => portal.shipments(), () => portal.payouts(), () => portal.assignedItems()]) await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  describe('split orders and shipments (MP-04)', () => {
    it('splits a multi-seller cart into one shipment per seller, each with its own status', async () => {
      await asCustomer();
      const order = await checkout('p-0010', 'p-0100', 'p-0001'); // two sellers and the store
      expect(order.shipments?.map((s) => s.sellerName).sort()).toEqual(['Acme Home & Kitchen', 'Urban Threads', 'the store']);
      expect(order.shipments?.every((s) => s.status === 'confirmed')).toBe(true);
      expect(new Set(order.shipments?.flatMap((s) => s.variantIds)).size).toBe(3);

      await asSeller();
      const mine = await firstValueFrom(portal.shipments());
      expect(mine).toHaveLength(1);
      expect(mine[0].items.map((i) => i.title)).toEqual([products.find((p) => p.id === 'p-0010')?.title]);
    });

    it('does not split an order that has no marketplace items', async () => {
      await asCustomer();
      expect((await checkout('p-0001')).shipments).toBeUndefined();
    });

    it('shows a seller only what is needed to ship: no email, no payment, no other sellers\' items', async () => {
      await asCustomer();
      await checkout('p-0010', 'p-0100');
      await asSeller();
      const [view] = await firstValueFrom(portal.shipments());
      expect(Object.keys(view).sort()).toEqual(['id', 'items', 'orderId', 'placedAt', 'shipTo', 'status', 'timeline']);
      expect(Object.keys(view.shipTo).sort()).toEqual(['city', 'line1', 'name', 'phone', 'pincode', 'state']);
      const text = JSON.stringify(view);
      expect(text).not.toContain(customer.email);
      for (const forbidden of ['"total"', 'paymentMethod', 'paymentStatus', 'razorpay', 'email']) expect(text).not.toContain(forbidden);
      expect(view.items).toHaveLength(1);
    });

    it('moves a shipment one step at a time, needs a tracking number to ship, and the customer sees it', async () => {
      await asCustomer();
      const order = await checkout('p-0010', 'p-0100');
      await asSeller();
      const [view] = await firstValueFrom(portal.shipments());
      await expect(firstValueFrom(portal.advanceShipment(view.id))).resolves.toMatchObject({ status: 'packed' });
      await expect(firstValueFrom(portal.advanceShipment(view.id))).rejects.toMatchObject({ fields: { trackingNumber: expect.any(String) } });
      await expect(firstValueFrom(portal.advanceShipment(view.id, 'bad!'))).rejects.toMatchObject({ code: 'validation' });
      const shipped = await firstValueFrom(portal.advanceShipment(view.id, 'DLV123456'));
      expect(shipped).toMatchObject({ status: 'shipped', trackingNumber: 'DLV123456' });

      await asCustomer();
      const seen = await firstValueFrom(orders.get(order.id));
      expect(seen.shipments?.find((s) => s.id === view.id)).toMatchObject({ status: 'shipped', trackingNumber: 'DLV123456' });
      expect(seen.shipments?.find((s) => s.id !== view.id)?.status).toBe('confirmed'); // the other seller has not moved
      expect(seen.status).toBe('confirmed'); // an order is as far along as its slowest shipment
    });

    it('refuses to let a seller touch another seller\'s shipment or an unpaid or cancelled order', async () => {
      await asCustomer();
      const order = await checkout('p-0010', 'p-0100');
      await asSeller();
      const other = (await firstValueFrom((await asCustomer(), orders.get(order.id)))).shipments?.find((s) => s.sellerId === 'sel_acme');
      await asSeller();
      await expect(firstValueFrom(portal.advanceShipment(other?.id ?? '', 'TRK12345'))).rejects.toMatchObject({ code: 'not_found' });

      await asCustomer();
      await firstValueFrom(orders.cancel(order.id));
      await asSeller();
      expect(await firstValueFrom(portal.shipments())).toEqual([]);
      // The seller's own shipment on a cancelled order can no longer be moved.
      await expect(firstValueFrom(portal.advanceShipment(`${order.id}-S1`, 'TRK12345'))).rejects.toMatchObject({ code: 'validation', message: 'This order is not ready to be fulfilled.' });
    });

    it('is delivered, and so returnable, only when every shipment is', async () => {
      await asCustomer();
      const order = await checkout('p-0010', 'p-0100');
      const walk = async (who: typeof seller | null, sellerId: string) => {
        if (who) await login(who);
        else await asCustomer();
        const sh = (await firstValueFrom(orders.get(order.id))).shipments?.find((s) => s.sellerId === sellerId);
        return sh?.id ?? '';
      };
      const ids = { demo: await walk(null, 'sel_demo'), acme: await walk(null, 'sel_acme') };
      await asSeller();
      await firstValueFrom(portal.advanceShipment(ids.demo));
      await firstValueFrom(portal.advanceShipment(ids.demo, 'TRK-DEMO-1'));
      await firstValueFrom(portal.advanceShipment(ids.demo));
      await asCustomer();
      expect((await firstValueFrom(orders.get(order.id))).status).toBe('confirmed'); // Acme has not shipped
      expect(await firstValueFrom(TestBed.inject(ReturnApi).eligibility(order.id))).toMatchObject({ eligible: false, reason: 'Only delivered orders can be returned.' });
    });

    it('cancels every shipment when the order is cancelled', async () => {
      await asCustomer();
      const order = await checkout('p-0010', 'p-0100');
      await firstValueFrom(orders.cancel(order.id));
      const stored = TestBed.inject(MockOrderStore).find(order.id) as Order;
      expect(stored.status).toBe('cancelled');
      expect((await firstValueFrom(orders.get(order.id))).shipments?.every((s) => s.status === 'cancelled')).toBe(true);
    });
  });

  describe('commission and payouts (MP-03)', () => {
    /** A customer order of one Urban Threads item, moved to delivered by the seller. */
    async function deliveredFromDemoSeller(productId = 'p-0010'): Promise<Order> {
      await asCustomer();
      const order = await checkout(productId);
      await asSeller();
      const [view] = (await firstValueFrom(portal.shipments())).filter((s) => s.orderId === order.id);
      await firstValueFrom(portal.advanceShipment(view.id));
      await firstValueFrom(portal.advanceShipment(view.id, 'TRK-PAY-1'));
      await firstValueFrom(portal.advanceShipment(view.id));
      return order;
    }
    const period = () => ({ from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });

    it('works out a statement from delivered orders, with commission by category, and reconciles to the order lines', async () => {
      const order = await deliveredFromDemoSeller('p-0010'); // a fashion item: the fashion rule is 12%
      await asAdmin();
      const { from, to } = period();
      const preview = await firstValueFrom(adminApi.payoutPreview('sel_demo', from, to));
      expect(preview.lines).toHaveLength(1);
      const gross = order.lines[0].lineTotal.amount - (order.totals.promotionDiscount?.amount ?? 0) - (order.totals.couponDiscount.amount ?? 0);
      expect(preview.lines[0]).toMatchObject({ orderId: order.id, percent: 12 });
      expect(preview.lines[0].gross).toBeLessThanOrEqual(order.lines[0].lineTotal.amount);
      expect(preview.lines[0].gross).toBeGreaterThanOrEqual(gross - 1);
      expect(preview.lines[0].commission).toBe(Math.floor((preview.lines[0].gross * 12) / 100));
      expect(preview).toMatchObject({ gross: preview.lines[0].gross, commission: preview.lines[0].commission, net: preview.lines[0].gross - preview.lines[0].commission });
    });

    it('uses a seller\'s own commission when set, and refuses silly percentages and clashing rules', async () => {
      await deliveredFromDemoSeller();
      await asAdmin();
      await firstValueFrom(adminApi.setCommission('sel_demo', 5));
      const { from, to } = period();
      expect((await firstValueFrom(adminApi.payoutPreview('sel_demo', from, to))).lines[0].percent).toBe(5);
      await expect(firstValueFrom(adminApi.setCommission('sel_demo', 80))).rejects.toMatchObject({ fields: { percent: expect.any(String) } });
      await firstValueFrom(adminApi.setCommission('sel_demo', null));
      expect((await firstValueFrom(adminApi.payoutPreview('sel_demo', from, to))).lines[0].percent).toBe(12);

      await expect(firstValueFrom(adminApi.saveRule({ scope: 'category', categoryId: 'cat-fashion', percent: 9 }))).rejects.toMatchObject({ code: 'conflict' });
      const leaf = products.find((p) => p.id === 'p-0010')?.categoryId as string;
      const rule = await firstValueFrom(adminApi.saveRule({ scope: 'category', categoryId: leaf, percent: 9 }));
      expect((await firstValueFrom(adminApi.payoutPreview('sel_demo', from, to))).lines[0].percent).toBe(9);
      await firstValueFrom(adminApi.removeRule(rule.id));
      await expect(firstValueFrom(adminApi.removeRule('rule-default'))).rejects.toMatchObject({ code: 'validation' });
      await expect(firstValueFrom(adminApi.saveRule({ scope: 'seller', sellerId: 'nobody', percent: 5 }))).rejects.toMatchObject({ fields: { sellerId: expect.any(String) } });
    });

    it('issues a statement once, claims its shipments, marks it paid, and shows the seller only their own', async () => {
      await deliveredFromDemoSeller();
      await asAdmin();
      const { from, to } = period();
      const st = await firstValueFrom(adminApi.issuePayout('sel_demo', from, to));
      expect(st).toMatchObject({ sellerId: 'sel_demo', status: 'issued' });
      expect(st.net).toBe(st.gross - st.commission);
      await expect(firstValueFrom(adminApi.issuePayout('sel_demo', from, to))).rejects.toMatchObject({ code: 'validation', message: 'Nothing to pay out in that period.' });
      await expect(firstValueFrom(adminApi.markPaid(st.id, 'x'))).rejects.toMatchObject({ fields: { reference: expect.any(String) } });
      const paid = await firstValueFrom(adminApi.markPaid(st.id, 'UTR1234567'));
      expect(paid).toMatchObject({ status: 'paid', reference: 'UTR1234567' });
      await expect(firstValueFrom(adminApi.markPaid(st.id, 'UTR7654321'))).rejects.toMatchObject({ code: 'conflict' });
      await expect(firstValueFrom(adminApi.payoutPreview('sel_demo', '2026-13-01', to))).rejects.toMatchObject({ fields: { from: expect.any(String) } });

      await asSeller();
      const mine = await firstValueFrom(portal.payouts());
      expect(mine.statements.map((s) => s.id)).toEqual([st.id]);
      expect(mine.upcoming.lines).toEqual([]);

      // The other seller sees none of it.
      await asAdmin();
      expect((await firstValueFrom(adminApi.statements())).map((s) => s.sellerName)).toEqual(['Urban Threads']);
    });

    it('takes back the sale and its commission when a returned item is refunded', async () => {
      const order = await deliveredFromDemoSeller();
      await asCustomer();
      const ret = await firstValueFrom(TestBed.inject(ReturnApi).create({ orderId: order.id, items: [{ variantId: order.lines[0].variantId, quantity: 1 }], reason: 'defective', comments: '', attachments: [] }));
      await asAdmin();
      const returns = TestBed.inject(AdminReturnApi);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await firstValueFrom(returns.approve(ret.id, { pickupDate: tomorrow }));
      await firstValueFrom(returns.markPickedUp(ret.id));
      await firstValueFrom(returns.recordCheck(ret.id, { result: 'accepted', note: 'ok', dispositions: { [order.lines[0].variantId]: 'restock' } }));
      await firstValueFrom(returns.refund(ret.id));

      const { from, to } = period();
      const preview = await firstValueFrom(adminApi.payoutPreview('sel_demo', from, to));
      expect(preview.adjustments).toHaveLength(1);
      expect(preview.adjustments[0]).toMatchObject({ returnId: ret.id, orderId: order.id });
      expect(preview.adjustments[0].gross).toBeLessThan(0);
      expect(preview.adjustments[0].commission).toBeLessThan(0);
      expect(preview.net).toBe(preview.lines[0].net + preview.adjustments[0].net);
      expect(preview.net).toBe(0); // the return reversed the whole sale, commission included
      const st = await firstValueFrom(adminApi.issuePayout('sel_demo', from, to));
      expect(st.net).toBe(0);
      await expect(firstValueFrom(adminApi.issuePayout('sel_demo', from, to))).rejects.toMatchObject({ message: 'Nothing to pay out in that period.' }); // the return is not counted twice
    });
  });

  describe('seller ratings (MP-05)', () => {
    it('gives shoppers a name, a rating from reviews of that seller\'s products, and policies, and nothing about KYC', async () => {
      const profile = await firstValueFrom(publicApi.profile('sel_demo'));
      expect(profile).toMatchObject({ id: 'sel_demo', displayName: 'Urban Threads', policies: { returns: expect.any(String), shipping: expect.any(String) } });
      expect(Object.keys(profile ?? {}).sort()).toEqual(['displayName', 'id', 'policies', 'rating', 'since']);
      const owned = (await firstValueFrom(catalog.productsByIds(['p-0010', 'p-0011', 'p-0012', 'p-0013'])))!;
      expect(profile?.rating).toEqual(sellerRating(owned));
      expect(profile?.rating.count).toBeGreaterThan(0);
      expect(await firstValueFrom(publicApi.profile('sel_new'))).toBeNull(); // pending
      expect(await firstValueFrom(publicApi.profile('nobody'))).toBeNull();
    });
  });
});
