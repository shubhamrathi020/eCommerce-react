import { Injectable, inject } from '@shop/core';
import type { Cart, Order, PaymentOption, PaymentResult, PaymentSession, PlaceOrderRequest, ShippingMethodId, ShippingOption } from '@ecom/contracts';
import type { Observable } from 'rxjs';
import { CartApi, CheckoutApi, OrderApi, PaymentApi } from '../lib/commerce.api';
import { ApiClient } from './api-client';

/** `CartApi` against the real backend (BRD 21). Works whether or not the shopper is signed in: the
 * server tells guest and account carts apart by cookie vs. bearer token, same as `MockCartState`. */
@Injectable()
export class HttpCartApi extends CartApi {
  private readonly api = inject(ApiClient);

  get(): Observable<Cart> {
    return this.api.optional('GET', '/cart');
  }

  add(variantId: string, quantity: number): Observable<Cart> {
    return this.api.optional('POST', '/cart/items', { variantId, quantity });
  }

  setQuantity(variantId: string, quantity: number): Observable<Cart> {
    return this.api.optional('PUT', `/cart/items/${encodeURIComponent(variantId)}`, { quantity });
  }

  remove(variantId: string): Observable<Cart> {
    return this.api.optional('DELETE', `/cart/items/${encodeURIComponent(variantId)}`);
  }

  applyCoupon(code: string): Observable<Cart> {
    return this.api.optional('POST', '/cart/coupon', { code });
  }

  removeCoupon(): Observable<Cart> {
    return this.api.optional('DELETE', '/cart/coupon');
  }

  setShippingMethod(method: ShippingMethodId): Observable<Cart> {
    return this.api.optional('PUT', '/cart/shipping-method', { method });
  }

  clear(): Observable<Cart> {
    return this.api.optional('DELETE', '/cart');
  }
}

/** `CheckoutApi` against the real backend: read-only, so it works the same for guest and account. */
@Injectable()
export class HttpCheckoutApi extends CheckoutApi {
  private readonly api = inject(ApiClient);

  shippingOptions(pincode: string): Observable<ShippingOption[]> {
    return this.api.optional('GET', `/checkout/shipping-options/${encodeURIComponent(pincode)}`);
  }

  paymentOptions(pincode: string): Observable<PaymentOption[]> {
    return this.api.optional('GET', `/checkout/payment-options/${encodeURIComponent(pincode)}`);
  }
}

/** `OrderApi` against the real backend. */
@Injectable()
export class HttpOrderApi extends OrderApi {
  private readonly api = inject(ApiClient);

  place(request: PlaceOrderRequest): Observable<Order> {
    return this.api.optional('POST', '/orders', request);
  }

  get(orderId: string): Observable<Order> {
    return this.api.optional('GET', `/orders/${encodeURIComponent(orderId)}`);
  }

  list(): Observable<Order[]> {
    return this.api.optional('GET', '/orders');
  }

  cancel(orderId: string): Observable<Order> {
    return this.api.optional('POST', `/orders/${encodeURIComponent(orderId)}/cancel`);
  }
}

/** `PaymentApi` against the real backend. */
@Injectable()
export class HttpPaymentApi extends PaymentApi {
  private readonly api = inject(ApiClient);

  initiate(orderId: string): Observable<PaymentSession> {
    return this.api.optional('POST', `/orders/${encodeURIComponent(orderId)}/payment/initiate`);
  }

  confirm(orderId: string, result: PaymentResult): Observable<Order> {
    return this.api.optional('POST', `/orders/${encodeURIComponent(orderId)}/payment/confirm`, result);
  }

  fail(orderId: string, reason: string): Observable<Order> {
    return this.api.optional('POST', `/orders/${encodeURIComponent(orderId)}/payment/fail`, { reason });
  }
}
