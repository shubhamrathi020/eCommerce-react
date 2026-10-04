import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { Order, Product } from '@ecom/contracts';
import { ATTACHMENT_LIMITS, computeRefund } from '@ecom/contracts';
import { AdminReturnApi, AdminSupportApi, AuditApi, AuthApi, DEMO_ACCOUNTS, MockInventoryStore, MockNotificationStore, ReturnApi, SupportApi, provideAdminDataAccess, provideDataAccess } from '../index';
import { loadCatalogData } from './catalog-data';
import { MockOrderStore } from './mock-order-store';

const customer = DEMO_ACCOUNTS[0];
const admin = DEMO_ACCOUNTS[1];
const DAY = 86_400_000;
const inr = (amount: number) => ({ amount, currency: 'INR' as const });

describe('returns, refunds and support (mock)', () => {
  let auth: AuthApi;
  let returns: ReturnApi;
  let support: SupportApi;
  let adminReturns: AdminReturnApi;
  let adminSupport: AdminSupportApi;
  let products: Product[];
  let seq = 0;

  /** An already-delivered order owned by `userId`, delivered `deliveredDaysAgo` days ago. */
  function orderFor(userId: string, opts: { deliveredDaysAgo?: number; quantity?: number; discount?: number; shipping?: number; payment?: 'razorpay' | 'cod'; lines?: number; status?: Order['status'] } = {}): Order {
    const { deliveredDaysAgo = 1, quantity = 2, discount = 0, shipping = 0, payment = 'cod', lines = 1, status = 'delivered' } = opts;
    const chosen = products.filter((p) => p.variants[0].stock > 10).slice(seq, seq + lines);
    seq += lines;
    const cartLines = chosen.map((p) => {
      const v = p.variants[0];
      return { productId: p.id, variantId: v.id, slug: p.slug, title: p.title, brandName: p.brandName, image: p.images[0], options: v.options, unitPrice: v.price, quantity, maxQuantity: 10, lineTotal: inr(v.price.amount * quantity), taxIncluded: inr(0) };
    });
    const subtotal = cartLines.reduce((n, l) => n + l.lineTotal.amount, 0);
    const confirmedAt = new Date(status === 'delivered' ? Date.now() - deliveredDaysAgo * DAY - 6 * 60_000 : Date.now() - 30_000).toISOString();
    return {
      id: `ORD-T${++seq}`,
      status,
      paymentStatus: payment === 'cod' ? 'cod' : 'paid',
      paymentMethod: payment,
      lines: cartLines,
      totals: { itemCount: quantity * lines, subtotal: inr(subtotal), mrpSavings: inr(0), couponDiscount: inr(discount), shipping: inr(shipping), taxIncluded: inr(0), total: inr(subtotal - discount + shipping) },
      shippingMethod: 'standard',
      contact: { name: 'Demo Customer', email: customer.email, phone: '9876543210' },
      address: { line1: '1 Main St', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      // Fulfilment progress is derived from the confirmation time (delivered 6 minutes later), so anchor on that.
      timeline: [
        { status: 'placed', label: 'Order placed', at: confirmedAt },
        { status: 'confirmed', label: 'Order confirmed', at: confirmedAt },
      ],
      createdAt: confirmedAt,
      userId,
    };
  }

  const save = (order: Order) => TestBed.inject(MockOrderStore).save(order);
  const loginAdmin = () => firstValueFrom(auth.login(admin.email, admin.password));
  const loginCustomer = () => firstValueFrom(auth.login(customer.email, customer.password));
  const reasonInput = { reason: 'changed_mind', comments: '', attachments: [] };

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true }), provideAdminDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    returns = TestBed.inject(ReturnApi);
    support = TestBed.inject(SupportApi);
    adminReturns = TestBed.inject(AdminReturnApi);
    adminSupport = TestBed.inject(AdminSupportApi);
    products = (await loadCatalogData()).products;
    seq = 0;
    await loginCustomer();
  });

  describe('eligibility (RF-01)', () => {
    it('allows delivered orders inside the window and says why not otherwise', async () => {
      const fresh = orderFor(customer.id);
      const old = orderFor(customer.id, { deliveredDaysAgo: 9 });
      const undelivered = orderFor(customer.id, { status: 'shipped' });
      [fresh, old, undelivered].forEach(save);

      const ok = await firstValueFrom(returns.eligibility(fresh.id));
      expect(ok).toMatchObject({ eligible: true, windowDays: 7 });
      expect(ok.lines[0]).toMatchObject({ ordered: 2, returnable: 2 });
      expect(await firstValueFrom(returns.eligibility(old.id))).toMatchObject({ eligible: false, reason: expect.stringContaining('7-day return window ended') });
      expect(await firstValueFrom(returns.eligibility(undelivered.id))).toMatchObject({ eligible: false, reason: 'Only delivered orders can be returned.' });
    });

    it("never reveals another customer's order", async () => {
      const other = orderFor('usr_someone_else');
      save(other);
      await expect(firstValueFrom(returns.eligibility(other.id))).rejects.toMatchObject({ code: 'not_found' });
      await expect(firstValueFrom(returns.create({ orderId: other.id, items: [{ variantId: other.lines[0].variantId, quantity: 1 }], ...reasonInput }))).rejects.toMatchObject({ code: 'not_found' });
    });

    it('requires a signed-in customer', async () => {
      const order = orderFor(customer.id);
      save(order);
      await firstValueFrom(auth.logout());
      await expect(firstValueFrom(returns.eligibility(order.id))).rejects.toMatchObject({ code: 'unauthorized' });
      await expect(firstValueFrom(returns.list())).rejects.toMatchObject({ code: 'unauthorized' });
    });

    it('allows only one open request per item and frees the item when a request ends', async () => {
      const order = orderFor(customer.id, { quantity: 2 });
      save(order);
      const variantId = order.lines[0].variantId;
      const first = await firstValueFrom(returns.create({ orderId: order.id, items: [{ variantId, quantity: 1 }], ...reasonInput }));

      const during = await firstValueFrom(returns.eligibility(order.id));
      expect(during.lines[0]).toMatchObject({ inOpenRequest: 1, returnable: 0, blockedReason: 'A return request for this item is already open.' });
      await expect(firstValueFrom(returns.create({ orderId: order.id, items: [{ variantId, quantity: 1 }], ...reasonInput }))).rejects.toMatchObject({ code: 'conflict' });

      await firstValueFrom(returns.cancel(first.id));
      expect((await firstValueFrom(returns.eligibility(order.id))).lines[0].returnable).toBe(2);
      await expect(firstValueFrom(returns.create({ orderId: order.id, items: [{ variantId, quantity: 3 }], ...reasonInput }))).rejects.toMatchObject({ code: 'validation' });
      await expect(firstValueFrom(returns.create({ orderId: order.id, items: [], ...reasonInput }))).rejects.toMatchObject({ fields: { items: expect.any(String) } });
      await expect(firstValueFrom(returns.create({ orderId: order.id, items: [{ variantId, quantity: 1 }], reason: 'nonsense', comments: '', attachments: [] }))).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
    });
  });

  describe('refund calculation (RF-03)', () => {
    const order = (over: Parameters<typeof orderFor>[1]) => {
      localStorage.clear();
      return orderFor(customer.id, over);
    };

    it('takes the proportional coupon share and deducts the fee when the customer changed their mind', () => {
      const o = order({ quantity: 1, lines: 2, discount: 1000, shipping: 4900 });
      const price = o.lines[0].unitPrice.amount;
      const subtotal = o.totals.subtotal.amount;
      const r = computeRefund(o, [{ variantId: o.lines[0].variantId, quantity: 1 }], 'changed_mind', { returnFee: 4900 });
      expect(r.items.amount).toBe(price);
      expect(r.discountShare.amount).toBe(Math.round((1000 * price) / subtotal));
      expect(r.shippingRefund.amount).toBe(0);
      expect(r.returnFee.amount).toBe(Math.min(4900, price - r.discountShare.amount));
      expect(r.total.amount).toBe(price - r.discountShare.amount - r.returnFee.amount);
      expect(r.method).toBe('store_credit'); // cash on delivery has no original method
    });

    it('refunds shipping only when it is our fault and the return completes the order', () => {
      const o = order({ quantity: 1, lines: 2, shipping: 4900, payment: 'razorpay' });
      const [a, b] = o.lines;
      const partial = computeRefund(o, [{ variantId: a.variantId, quantity: 1 }], 'damaged', { returnFee: 4900 });
      expect(partial).toMatchObject({ shippingRefund: { amount: 0 }, returnFee: { amount: 0 }, method: 'original' });
      expect(partial.total.amount).toBe(a.unitPrice.amount);
      const whole = computeRefund(o, [{ variantId: a.variantId, quantity: 1 }, { variantId: b.variantId, quantity: 1 }], 'damaged', { returnFee: 4900 });
      expect(whole.shippingRefund.amount).toBe(4900);
      // Whole order across two requests: the second one carries the shipping.
      const second = computeRefund(o, [{ variantId: b.variantId, quantity: 1 }], 'damaged', { returnFee: 4900 }, { [a.variantId]: 1 });
      expect(second.shippingRefund.amount).toBe(4900);
      // Changing your mind never refunds shipping.
      expect(computeRefund(o, [{ variantId: a.variantId, quantity: 1 }, { variantId: b.variantId, quantity: 1 }], 'changed_mind', { returnFee: 4900 }).shippingRefund.amount).toBe(0);
    });

    it('is computed by the API and shown before the customer submits', async () => {
      const o = orderFor(customer.id, { quantity: 1, discount: 500 });
      save(o);
      const quote = await firstValueFrom(returns.quote(o.id, [{ variantId: o.lines[0].variantId, quantity: 1 }], 'changed_mind'));
      const created = await firstValueFrom(returns.create({ orderId: o.id, items: [{ variantId: o.lines[0].variantId, quantity: 1 }], ...reasonInput }));
      expect(created.refund).toEqual(quote);
    });
  });

  describe('lifecycle (RF-02, RF-04, RF-05)', () => {
    async function requested(over: Parameters<typeof orderFor>[1] = {}, quantity = 1) {
      const o = orderFor(customer.id, over);
      save(o);
      const r = await firstValueFrom(returns.create({ orderId: o.id, items: [{ variantId: o.lines[0].variantId, quantity }], ...reasonInput, reason: 'defective' }));
      return { o, r };
    }
    const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const onHand = (variantId: string) =>
      TestBed.inject(MockInventoryStore)
        .apply(products, 'onHand')
        .flatMap((p) => p.variants)
        .find((v) => v.id === variantId)?.stock;

    it('walks requested to refunded, restocks, credits the customer and audits every step', async () => {
      const { o, r } = await requested({ quantity: 2 }, 2);
      const variantId = o.lines[0].variantId;
      const before = onHand(variantId) as number;
      expect(r.status).toBe('requested');
      expect(r.timeline.map((t) => t.status)).toEqual(['requested']);

      await loginAdmin();
      expect((await firstValueFrom(adminReturns.list({ page: 1, pageSize: 10 }))).items[0].id).toBe(r.id);
      const approved = await firstValueFrom(adminReturns.approve(r.id, { pickupDate: tomorrow(), note: 'Call first' }));
      expect(approved).toMatchObject({ status: 'approved', pickup: { date: tomorrow(), note: 'Call first' } });
      await expect(firstValueFrom(adminReturns.approve(r.id, { pickupDate: tomorrow() }))).rejects.toMatchObject({ code: 'validation' }); // not twice
      await expect(firstValueFrom(adminReturns.refund(r.id))).rejects.toMatchObject({ code: 'validation' }); // not before the check
      await firstValueFrom(adminReturns.markPickedUp(r.id));

      await expect(firstValueFrom(adminReturns.recordCheck(r.id, { result: 'accepted', note: 'Looks fine' }))).rejects.toMatchObject({ fields: { dispositions: expect.any(String) } });
      expect(onHand(variantId)).toBe(before); // a failed check changes nothing
      const checked = await firstValueFrom(adminReturns.recordCheck(r.id, { result: 'accepted', note: 'Looks fine', dispositions: { [variantId]: 'restock' } }));
      expect(checked).toMatchObject({ status: 'checked', check: { result: 'accepted' } });
      expect(onHand(variantId)).toBe(before + 2); // restocked units reappear in stock (RF-05)
      expect(TestBed.inject(MockInventoryStore).movements()[0]).toMatchObject({ kind: 'return', quantity: 2, reason: 'customer_return', note: `Return ${r.id}` });

      const refunded = await firstValueFrom(adminReturns.refund(r.id));
      expect(refunded.status).toBe('refunded');
      expect(refunded.timeline.map((t) => t.status)).toEqual(['requested', 'approved', 'picked_up', 'checked', 'refunded']);

      await loginCustomer();
      expect(await firstValueFrom(returns.get(r.id))).toMatchObject({ status: 'refunded' });
      expect(await firstValueFrom(returns.storeCredit())).toEqual(r.refund.total); // cash on delivery goes to store credit
      const inbox = TestBed.inject(MockNotificationStore)
        .deliveryLog()
        .map((e) => e.templateKey);
      expect(inbox).toEqual(expect.arrayContaining(['return_requested', 'return_approved', 'refund_issued']));

      await loginAdmin();
      const actions = (await firstValueFrom(TestBed.inject(AuditApi).list({ page: 1, pageSize: 50 }))).items.map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['return.approve', 'return.pickup', 'return.check', 'return.refund']));
    });

    it('records a scrapped item as received and written off, so stock does not rise', async () => {
      const { o, r } = await requested();
      const variantId = o.lines[0].variantId;
      const before = onHand(variantId) as number;
      await loginAdmin();
      await firstValueFrom(adminReturns.approve(r.id, { pickupDate: tomorrow() }));
      await firstValueFrom(adminReturns.markPickedUp(r.id));
      await firstValueFrom(adminReturns.recordCheck(r.id, { result: 'accepted', note: 'Cracked casing', dispositions: { [variantId]: 'scrap' } }));
      expect(onHand(variantId)).toBe(before);
      expect(
        TestBed.inject(MockInventoryStore)
          .movements()
          .slice(0, 2)
          .map((m) => m.kind),
      ).toEqual(['damage', 'return']);
    });

    it('rejects at review or at the quality check, with a reason, notifies the customer and frees the items', async () => {
      const { o, r } = await requested();
      await loginAdmin();
      await expect(firstValueFrom(adminReturns.reject(r.id, ' '))).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
      const rejected = await firstValueFrom(adminReturns.reject(r.id, 'Item shows signs of use'));
      expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Item shows signs of use' });
      await loginCustomer();
      expect((await firstValueFrom(returns.eligibility(o.id))).lines[0].returnable).toBe(2);

      const second = await firstValueFrom(returns.create({ orderId: o.id, items: [{ variantId: o.lines[0].variantId, quantity: 1 }], ...reasonInput }));
      await loginAdmin();
      await firstValueFrom(adminReturns.approve(second.id, { pickupDate: tomorrow() }));
      await firstValueFrom(adminReturns.markPickedUp(second.id));
      const failed = await firstValueFrom(adminReturns.recordCheck(second.id, { result: 'rejected', note: 'Used and washed' }));
      expect(failed).toMatchObject({ status: 'rejected', check: { result: 'rejected' } });
      expect(TestBed.inject(MockInventoryStore).movements()).toHaveLength(0);
      expect(TestBed.inject(MockNotificationStore).deliveryLog().filter((e) => e.templateKey === 'return_rejected')).toHaveLength(2);
    });

    it('lets the customer withdraw only before approval', async () => {
      const { r } = await requested();
      await loginAdmin();
      await firstValueFrom(adminReturns.approve(r.id, { pickupDate: tomorrow() }));
      await loginCustomer();
      await expect(firstValueFrom(returns.cancel(r.id))).rejects.toMatchObject({ code: 'validation' });
    });

    it('validates the pickup date', async () => {
      const { r } = await requested();
      await loginAdmin();
      await expect(firstValueFrom(adminReturns.approve(r.id, { pickupDate: '' }))).rejects.toMatchObject({ fields: { pickupDate: expect.any(String) } });
      await expect(firstValueFrom(adminReturns.approve(r.id, { pickupDate: '2020-01-01' }))).rejects.toMatchObject({ fields: { pickupDate: expect.any(String) } });
      await expect(firstValueFrom(adminReturns.approve(r.id, { pickupDate: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) }))).rejects.toMatchObject({ fields: { pickupDate: expect.any(String) } });
    });

    it('keeps customers out of the queue and staff-only actions', async () => {
      const { r } = await requested();
      for (const call of [() => adminReturns.list({ page: 1, pageSize: 5 }), () => adminReturns.approve(r.id, { pickupDate: tomorrow() }), () => adminReturns.policy(), () => adminReturns.pendingOrderRefunds(), () => adminSupport.list({ page: 1, pageSize: 5 })]) {
        await expect(firstValueFrom(call())).rejects.toMatchObject({ code: 'forbidden' });
      }
    });
  });

  describe('policy (RF-07)', () => {
    it('applies changes to new requests only and can mark products non-returnable', async () => {
      const o = orderFor(customer.id, { deliveredDaysAgo: 5, quantity: 1, lines: 2 });
      save(o);
      const first = await firstValueFrom(returns.create({ orderId: o.id, items: [{ variantId: o.lines[0].variantId, quantity: 1 }], ...reasonInput }));
      expect(first.policy).toEqual({ windowDays: 7, returnFee: 4900 });

      await loginAdmin();
      await expect(firstValueFrom(adminReturns.savePolicy({ windowDays: 400, returnFee: 100, excludedCategoryIds: [], excludedProductIds: [] }))).rejects.toMatchObject({ fields: { windowDays: expect.any(String) } });
      const saved = await firstValueFrom(adminReturns.savePolicy({ windowDays: 3, returnFee: 0, excludedCategoryIds: [], excludedProductIds: [o.lines[1].productId] }));
      expect(saved).toMatchObject({ windowDays: 3, updatedBy: admin.name });

      await loginCustomer();
      expect((await firstValueFrom(returns.get(first.id))).policy).toEqual({ windowDays: 7, returnFee: 4900 }); // unchanged
      const now = await firstValueFrom(returns.eligibility(o.id));
      expect(now.eligible).toBe(false); // delivered 5 days ago, window is now 3
      expect(now.reason).toContain('3-day return window');

      await loginAdmin();
      await firstValueFrom(adminReturns.savePolicy({ windowDays: 7, returnFee: 4900, excludedCategoryIds: [], excludedProductIds: [o.lines[1].productId] }));
      await loginCustomer();
      const eligibility = await firstValueFrom(returns.eligibility(o.id));
      expect(eligibility.lines[1]).toMatchObject({ returnable: 0, blockedReason: 'This item cannot be returned.' });
      // Line 0 is still in the first (open) request and line 1 is excluded, so nothing in the order can be requested.
      await expect(firstValueFrom(returns.create({ orderId: o.id, items: [{ variantId: o.lines[1].variantId, quantity: 1 }], ...reasonInput }))).rejects.toMatchObject({ message: expect.any(String) });
    });

    it('blocks a whole category', async () => {
      const o = orderFor(customer.id, { quantity: 1 });
      save(o);
      const product = products.find((p) => p.id === o.lines[0].productId) as Product;
      await loginAdmin();
      await firstValueFrom(adminReturns.savePolicy({ windowDays: 7, returnFee: 4900, excludedCategoryIds: [product.categoryPath[0]?.id ?? product.categoryId], excludedProductIds: [] }));
      await loginCustomer();
      expect((await firstValueFrom(returns.eligibility(o.id))).eligible).toBe(false);
    });
  });

  describe('attachments (RF-08)', () => {
    it('limits type, size and count', async () => {
      const o = orderFor(customer.id);
      save(o);
      const input = { orderId: o.id, items: [{ variantId: o.lines[0].variantId, quantity: 1 }], reason: 'damaged', comments: '' };
      const png = { name: 'a.png', type: 'image/png', size: 1000 };
      await expect(firstValueFrom(returns.create({ ...input, attachments: [{ name: 'run.exe', type: 'application/x-msdownload', size: 10 }] }))).rejects.toMatchObject({ fields: { attachments: expect.stringContaining('only JPEG, PNG, WebP or PDF') } });
      await expect(firstValueFrom(returns.create({ ...input, attachments: [{ ...png, size: ATTACHMENT_LIMITS.maxBytes + 1 }] }))).rejects.toMatchObject({ fields: { attachments: expect.stringContaining('at most 2 MB') } });
      await expect(firstValueFrom(returns.create({ ...input, attachments: [png, png, png, png] }))).rejects.toMatchObject({ fields: { attachments: expect.stringContaining('at most 3') } });
      expect((await firstValueFrom(returns.create({ ...input, attachments: [png] }))).attachments).toEqual([png]);
    });
  });

  describe('cancelled prepaid orders (RF-04)', () => {
    it('moves from refund pending to refunded when staff pay it back', async () => {
      const o = { ...orderFor(customer.id, { payment: 'razorpay', status: 'cancelled' }), paymentStatus: 'refund_pending' as const };
      save(o);
      expect(await firstValueFrom(returns.orderRefund(o.id))).toMatchObject({ orderId: o.id, method: 'original', amount: o.totals.total });
      expect((await firstValueFrom(returns.orderRefund(o.id)))?.refundedAt).toBeUndefined();

      await loginAdmin();
      expect((await firstValueFrom(adminReturns.pendingOrderRefunds())).map((p) => p.orderId)).toContain(o.id);
      const done = await firstValueFrom(adminReturns.refundOrder(o.id));
      expect(done.refundedAt).toBeDefined();
      await expect(firstValueFrom(adminReturns.refundOrder(o.id))).rejects.toMatchObject({ code: 'conflict' });
      expect((await firstValueFrom(adminReturns.pendingOrderRefunds())).map((p) => p.orderId)).not.toContain(o.id);

      await loginCustomer();
      expect((await firstValueFrom(returns.orderRefund(o.id)))?.refundedAt).toBe(done.refundedAt);
    });

    it('has nothing to report for an order that is not awaiting a refund', async () => {
      const o = orderFor(customer.id);
      save(o);
      expect(await firstValueFrom(returns.orderRefund(o.id))).toBeNull();
    });
  });

  describe('support tickets (RF-06)', () => {
    it('creates, replies, and closes with timestamps; the customer sees only their own', async () => {
      const o = orderFor(customer.id);
      save(o);
      await expect(firstValueFrom(support.create({ subject: '', message: '', attachments: [] }))).rejects.toMatchObject({ fields: { subject: expect.any(String), message: expect.any(String) } });
      await expect(firstValueFrom(support.create({ subject: 'Where is it?', message: 'Hi', orderId: 'ORD-NOPE', attachments: [] }))).rejects.toMatchObject({ fields: { orderId: expect.any(String) } });
      const ticket = await firstValueFrom(support.create({ subject: 'Where is my parcel?', message: 'It is late.', orderId: o.id, attachments: [] }));
      expect(ticket).toMatchObject({ status: 'open', orderId: o.id, messages: [{ author: 'customer', body: 'It is late.' }] });
      expect(Date.parse(ticket.messages[0].at)).not.toBeNaN();

      await loginAdmin();
      const queue = await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10 }));
      expect(queue.items[0].id).toBe(ticket.id);
      const replied = await firstValueFrom(adminSupport.reply(ticket.id, { message: 'Checking with the courier.' }));
      expect(replied).toMatchObject({ status: 'pending', assignee: admin.name });
      expect(replied.messages.map((m) => m.author)).toEqual(['customer', 'staff']);

      await loginCustomer();
      const mine = await firstValueFrom(support.reply(ticket.id, { message: 'Thanks!' }));
      expect(mine.status).toBe('open');
      expect(mine.messages).toHaveLength(3);
      const closed = await firstValueFrom(support.close(ticket.id));
      expect(closed.status).toBe('closed');
      await expect(firstValueFrom(support.reply(ticket.id, { message: 'More?' }))).rejects.toMatchObject({ code: 'validation' });

      // A different customer sees none of it.
      await firstValueFrom(auth.logout());
      await firstValueFrom(auth.register({ name: 'Other Person', email: 'other.person@example.com', password: 'Other@1234' }));
      expect(await firstValueFrom(support.list())).toEqual([]);
      await expect(firstValueFrom(support.get(ticket.id))).rejects.toMatchObject({ code: 'not_found' });
      await expect(firstValueFrom(support.reply(ticket.id, { message: 'hi' }))).rejects.toMatchObject({ code: 'not_found' });
    });

    it('filters the queue by status and assignee, and lets staff reassign and reopen', async () => {
      const a = await firstValueFrom(support.create({ subject: 'Question A', message: 'a', attachments: [] }));
      await firstValueFrom(support.create({ subject: 'Question B', message: 'b', attachments: [] }));
      await loginAdmin();
      expect((await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10, assignee: 'none' }))).total).toBe(2);
      await firstValueFrom(adminSupport.assign(a.id, admin.name));
      expect((await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10, assignee: 'me' }))).items.map((t) => t.id)).toEqual([a.id]);
      expect((await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10, assignee: 'none' }))).total).toBe(1);
      expect((await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10, q: 'question b' }))).total).toBe(1);
      await firstValueFrom(adminSupport.setStatus(a.id, 'closed'));
      expect((await firstValueFrom(adminSupport.list({ page: 1, pageSize: 10, status: 'closed' }))).items.map((t) => t.id)).toEqual([a.id]);
      await expect(firstValueFrom(adminSupport.reply(a.id, { message: 'x' }))).rejects.toMatchObject({ code: 'validation' });
      await firstValueFrom(adminSupport.setStatus(a.id, 'open'));
      expect((await firstValueFrom(adminSupport.assign(a.id, null))).assignee).toBeUndefined();
    });
  });
});
