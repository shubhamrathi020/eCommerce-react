import { provideHttpClient } from '@shop/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@shop/core/testing';
import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { ApiClient, CartApi, CheckoutApi, OrderApi, PaymentApi, provideDataAccess } from '../index';

const BASE = 'http://api.test';

describe('HTTP adapters for cart, checkout, orders and payments (realCommerce, BRD 21)', () => {
  let http: HttpTestingController;
  let cart: CartApi;
  let checkout: CheckoutApi;
  let orders: OrderApi;
  let payments: PaymentApi;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { useMocks: true, realCommerce: true, apiBaseUrl: `${BASE}/`, siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true, realCommerce: true }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    cart = TestBed.inject(CartApi);
    checkout = TestBed.inject(CheckoutApi);
    orders = TestBed.inject(OrderApi);
    payments = TestBed.inject(PaymentApi);
  });
  afterEach(() => http.verify());

  const emptyCart = { lines: [], shippingMethod: 'standard', totals: { itemCount: 0, subtotal: { amount: 0, currency: 'INR' }, mrpSavings: { amount: 0, currency: 'INR' }, couponDiscount: { amount: 0, currency: 'INR' }, shipping: { amount: 0, currency: 'INR' }, taxIncluded: { amount: 0, currency: 'INR' }, total: { amount: 0, currency: 'INR' } }, notices: [], blocked: false };

  it('reads the cart with credentials, and attaches a bearer token when one is set (still succeeds without one)', async () => {
    const result = firstValueFrom(cart.get());
    const req = http.expectOne(`${BASE}/cart`);
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('authorization')).toBeNull();
    req.flush(emptyCart);
    expect((await result).lines).toEqual([]);

    TestBed.inject(ApiClient).setAccessToken('token-abc');
    const signedInResult = firstValueFrom(cart.get());
    const signedInReq = http.expectOne(`${BASE}/cart`);
    expect(signedInReq.request.headers.get('authorization')).toBe('Bearer token-abc');
    signedInReq.flush(emptyCart);
    await signedInResult;
  });

  it('sends the CSRF header on cart mutations, not on reads', async () => {
    const readResult = firstValueFrom(cart.get());
    const readReq = http.expectOne(`${BASE}/cart`);
    expect(readReq.request.headers.get('x-csrf')).toBeNull();
    readReq.flush(emptyCart);
    await readResult;

    const addResult = firstValueFrom(cart.add('v-1', 2));
    const addReq = http.expectOne(`${BASE}/cart/items`);
    expect(addReq.request.headers.get('x-csrf')).toBe('1');
    expect(addReq.request.body).toEqual({ variantId: 'v-1', quantity: 2 });
    addReq.flush(emptyCart);
    await addResult;
  });

  it('adjusts quantity, removes, applies/removes a coupon, sets shipping method, and clears', async () => {
    const setQty = firstValueFrom(cart.setQuantity('v-1', 3));
    http.expectOne(`${BASE}/cart/items/v-1`).flush(emptyCart);
    await setQty;

    const removed = firstValueFrom(cart.remove('v-1'));
    const removeReq = http.expectOne(`${BASE}/cart/items/v-1`);
    expect(removeReq.request.method).toBe('DELETE');
    removeReq.flush(emptyCart);
    await removed;

    const applied = firstValueFrom(cart.applyCoupon('WELCOME10'));
    const couponReq = http.expectOne(`${BASE}/cart/coupon`);
    expect(couponReq.request.body).toEqual({ code: 'WELCOME10' });
    couponReq.flush(emptyCart);
    await applied;

    const removedCoupon = firstValueFrom(cart.removeCoupon());
    http.expectOne(`${BASE}/cart/coupon`).flush(emptyCart);
    await removedCoupon;

    const shipped = firstValueFrom(cart.setShippingMethod('express'));
    const shipReq = http.expectOne(`${BASE}/cart/shipping-method`);
    expect(shipReq.request.body).toEqual({ method: 'express' });
    shipReq.flush(emptyCart);
    await shipped;

    const cleared = firstValueFrom(cart.clear());
    http.expectOne(`${BASE}/cart`).flush(emptyCart);
    await cleared;
  });

  it('fetches shipping and payment options for a pin code', async () => {
    const shipping = firstValueFrom(checkout.shippingOptions('560001'));
    http.expectOne(`${BASE}/checkout/shipping-options/560001`).flush([{ id: 'standard', label: 'Standard', price: { amount: 0, currency: 'INR' }, estimatedDays: 3, estimatedDate: '2026-01-01' }]);
    expect((await shipping)[0].id).toBe('standard');

    const payment = firstValueFrom(checkout.paymentOptions('560001'));
    http.expectOne(`${BASE}/checkout/payment-options/560001`).flush([{ method: 'cod', label: 'Cash on delivery', enabled: true }]);
    expect((await payment)[0].method).toBe('cod');
  });

  it('places, gets, lists and cancels an order', async () => {
    const request = { idempotencyKey: 'k-1', contact: { name: 'A', email: 'a@b.co', phone: '9876543210' }, address: { line1: '1', city: 'B', state: 'K', pincode: '560001' }, paymentMethod: 'cod' as const };
    const placed = firstValueFrom(orders.place(request));
    const placeReq = http.expectOne(`${BASE}/orders`);
    expect(placeReq.request.headers.get('x-csrf')).toBe('1');
    expect(placeReq.request.body).toEqual(request);
    placeReq.flush({ id: 'ORD-1', status: 'confirmed' });
    expect((await placed).id).toBe('ORD-1');

    const got = firstValueFrom(orders.get('ORD-1'));
    http.expectOne(`${BASE}/orders/ORD-1`).flush({ id: 'ORD-1' });
    await got;

    const listed = firstValueFrom(orders.list());
    http.expectOne(`${BASE}/orders`).flush([{ id: 'ORD-1' }]);
    expect((await listed)[0].id).toBe('ORD-1');

    const cancelled = firstValueFrom(orders.cancel('ORD-1'));
    const cancelReq = http.expectOne(`${BASE}/orders/ORD-1/cancel`);
    expect(cancelReq.request.headers.get('x-csrf')).toBe('1');
    cancelReq.flush({ id: 'ORD-1', status: 'cancelled' });
    expect((await cancelled).status).toBe('cancelled');
  });

  it('initiates, confirms and fails a payment', async () => {
    const initiated = firstValueFrom(payments.initiate('ORD-1'));
    const initReq = http.expectOne(`${BASE}/orders/ORD-1/payment/initiate`);
    expect(initReq.request.headers.get('x-csrf')).toBe('1');
    initReq.flush({ orderId: 'ORD-1', providerOrderId: 'order_x', keyId: 'rzp_test_x', amount: 100, currency: 'INR' });
    expect((await initiated).providerOrderId).toBe('order_x');

    const result = { providerPaymentId: 'pay_1', providerOrderId: 'order_x', signature: 'sig' };
    const confirmed = firstValueFrom(payments.confirm('ORD-1', result));
    const confirmReq = http.expectOne(`${BASE}/orders/ORD-1/payment/confirm`);
    expect(confirmReq.request.body).toEqual(result);
    confirmReq.flush({ id: 'ORD-1', status: 'confirmed', paymentStatus: 'paid' });
    expect((await confirmed).paymentStatus).toBe('paid');

    const failed = firstValueFrom(payments.fail('ORD-1', 'card declined'));
    const failReq = http.expectOne(`${BASE}/orders/ORD-1/payment/fail`);
    expect(failReq.request.body).toEqual({ reason: 'card declined' });
    failReq.flush({ id: 'ORD-1', paymentStatus: 'failed' });
    expect((await failed).paymentStatus).toBe('failed');
  });
});
