import type { Observable } from 'rxjs';
import type { Cart, Order, PaymentOption, PaymentResult, PaymentSession, PlaceOrderRequest, ShippingMethodId, ShippingOption } from '@ecom/contracts';

/**
 * Server-side cart. Every method returns the freshly priced cart; the client never computes money.
 * Errors are `ApiException`s (`validation` carries a user-readable message).
 */
export abstract class CartApi {
  abstract get(): Observable<Cart>;
  abstract add(variantId: string, quantity: number): Observable<Cart>;
  abstract setQuantity(variantId: string, quantity: number): Observable<Cart>;
  abstract remove(variantId: string): Observable<Cart>;
  abstract applyCoupon(code: string): Observable<Cart>;
  abstract removeCoupon(): Observable<Cart>;
  abstract setShippingMethod(method: ShippingMethodId): Observable<Cart>;
  abstract clear(): Observable<Cart>;
}

export abstract class CheckoutApi {
  /** Errors with `validation` when the pin code is malformed or not deliverable. */
  abstract shippingOptions(pincode: string): Observable<ShippingOption[]>;
  abstract paymentOptions(pincode: string): Observable<PaymentOption[]>;
}

export abstract class OrderApi {
  /** Idempotent on `idempotencyKey`. */
  abstract place(request: PlaceOrderRequest): Observable<Order>;
  abstract get(orderId: string): Observable<Order>;
  /** Orders known to this device/session, newest first. */
  abstract list(): Observable<Order[]>;
  abstract cancel(orderId: string): Observable<Order>;
}

export abstract class PaymentApi {
  abstract initiate(orderId: string): Observable<PaymentSession>;
  /** Verifies the provider's signature; only then is the order marked paid. */
  abstract confirm(orderId: string, result: PaymentResult): Observable<Order>;
  abstract fail(orderId: string, reason: string): Observable<Order>;
}
