import { Injectable, inject } from '@shop/core';
import type { Order, PaymentResult, PaymentSession } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { PaymentApi } from '../lib/commerce.api';
import { EMPTY_STORED_CART } from './cart-engine';
import { loadCatalogData } from './catalog-data';
import { MockInventoryStore } from './inventory-store';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';
import { MockOrderStore, cancelExpiredOrders } from './mock-order-store';
import { MockNotificationStore } from './notification-store';
import { MockPromotionStore } from './promotion-store';
import { MockSellerStore } from './seller-store';
import { MockUserStore } from './mock-user-store';

/** Public test key id (never a secret). */
export const MOCK_RAZORPAY_KEY_ID = 'rzp_test_mock';

/**
 * Stand-in for Razorpay's HMAC signature. In production the backend verifies the real
 * signature with the key secret, which never reaches the browser.
 */
export function mockSignature(providerOrderId: string, providerPaymentId: string): string {
  let hash = 5381;
  for (const ch of `${providerOrderId}|${providerPaymentId}|mock`) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  return `mocksig_${(hash >>> 0).toString(16)}`;
}

@Injectable()
export class MockPaymentApi extends PaymentApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockOrderStore);
  private readonly cart = inject(MockCartState);
  private readonly inventory = inject(MockInventoryStore);
  private readonly notifications = inject(MockNotificationStore);
  private readonly users = inject(MockUserStore);
  private readonly wallet = inject(MockPromotionStore);
  private readonly sellers = inject(MockSellerStore);

  private orderOrThrow(orderId: string): Order {
    const order = this.store.find(orderId);
    if (!order) throw new ApiException('not_found', 'Order not found');
    return order;
  }

  initiate(orderId: string) {
    return this.respond.okAsync<PaymentSession>(async () => {
      const order = this.orderOrThrow(orderId);
      if (order.status !== 'pending_payment') throw new ApiException('validation', 'This order does not need a payment.');
      return { orderId, providerOrderId: `order_mock_${orderId}`, keyId: MOCK_RAZORPAY_KEY_ID, amount: order.totals.total.amount, currency: 'INR' };
    });
  }

  confirm(orderId: string, result: PaymentResult) {
    return this.respond.okAsync<Order>(async () => {
      const { products } = await loadCatalogData();
      cancelExpiredOrders(this.store, this.inventory, products, Date.now(), (o) => {
        this.sellers.cancelShipments(o.id);
        return this.wallet.refund(o, 'System');
      });
      const order = this.orderOrThrow(orderId);
      if (order.paymentStatus === 'paid') return order;
      if (order.status === 'cancelled') throw new ApiException('validation', 'The payment window for this order expired and its items were released. Please place the order again.');
      if (order.status !== 'pending_payment') throw new ApiException('validation', 'This order can no longer be paid.');
      const valid = result.providerOrderId === `order_mock_${orderId}` && result.signature === mockSignature(result.providerOrderId, result.providerPaymentId);
      if (!valid) throw new ApiException('validation', 'Payment verification failed. If money was deducted it will be refunded.');
      // Paid: the reserved units become a sale. After a failed attempt the hold was released, so availability is checked again.
      this.inventory.sell(orderId, order.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), products, 'Payment');
      const now = new Date().toISOString();
      const paid: Order = {
        ...order,
        status: 'confirmed',
        paymentStatus: 'paid',
        timeline: [...order.timeline, { status: 'paid', label: 'Payment received', at: now }, { status: 'confirmed', label: 'Order confirmed', at: now }],
      };
      this.store.save(paid);
      this.cart.write({ ...EMPTY_STORED_CART, items: [], shippingMethod: order.shippingMethod });
      this.notifications.deliver('order_paid', order.contact.email, { name: order.contact.name, orderId: order.id }, { userId: this.users.currentUserId() ?? undefined, link: `/orders/${order.id}` });
      return paid;
    });
  }

  fail(orderId: string, _reason: string) {
    return this.respond.okAsync<Order>(async () => {
      const order = this.orderOrThrow(orderId);
      if (order.paymentStatus === 'paid') return order;
      // A failed payment gives its stock back; a retry claims it again.
      this.inventory.release(orderId, (await loadCatalogData()).products);
      const failed: Order = { ...order, paymentStatus: 'failed' };
      this.store.save(failed);
      return failed;
    });
  }
}
