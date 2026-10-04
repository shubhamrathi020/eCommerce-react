import { Injectable, inject } from '@shop/core';
import type { Order, PlaceOrderRequest } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { formatMoney } from '@shop/core';
import { OrderApi } from '../lib/commerce.api';
import { EMPTY_STORED_CART } from './cart-engine';
import { loadCatalogData } from './catalog-data';
import { MockInventoryStore } from './inventory-store';
import { MockNotificationStore } from './notification-store';
import { MockPromotionStore } from './promotion-store';
import { AttributionService } from '@shop/core';
import { MockSellerStore } from './seller-store';
import { codEligibility, validateDeliverable } from './mock-checkout.api';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';
import { MockOrderStore, cancelExpiredOrders, withProgress } from './mock-order-store';
import { MockUserStore } from './mock-user-store';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[6-9][0-9]{9}$/;

function newOrderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

@Injectable()
export class MockOrderApi extends OrderApi {
  private readonly respond = createMockResponder();
  private readonly cart = inject(MockCartState);
  private readonly store = inject(MockOrderStore);
  private readonly users = inject(MockUserStore);
  private readonly inventory = inject(MockInventoryStore);
  private readonly notifications = inject(MockNotificationStore);
  private readonly wallet = inject(MockPromotionStore);
  private readonly attribution = inject(AttributionService);
  private readonly sellers = inject(MockSellerStore);

  /** Frees the stock of unpaid orders whose reservation expired; returns the seeded catalog for stock work. */
  private async sweep() {
    const { products } = await loadCatalogData();
    cancelExpiredOrders(this.store, this.inventory, products, Date.now(), (o) => {
      this.sellers.cancelShipments(o.id);
      return this.wallet.refund(o, 'System');
    });
    return products;
  }

  place(request: PlaceOrderRequest) {
    return this.respond.okAsync<Order>(async () => {
      const products = await this.sweep();
      // Idempotency: the same key always returns the same order.
      const existingId = this.store.orderIdForKey(request.idempotencyKey);
      const existing = existingId ? this.store.find(existingId) : undefined;
      if (existing) return withProgress(existing, Date.now());

      const fields: Record<string, string> = {};
      if (!request.contact.name.trim()) fields['name'] = 'Name is required';
      if (!EMAIL.test(request.contact.email)) fields['email'] = 'Enter a valid email address';
      if (!PHONE.test(request.contact.phone)) fields['phone'] = 'Enter a valid 10-digit mobile number';
      if (!request.address.line1.trim()) fields['line1'] = 'Address is required';
      if (!request.address.city.trim()) fields['city'] = 'City is required';
      if (!request.address.state.trim()) fields['state'] = 'State is required';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      validateDeliverable(request.address.pincode);

      const { cart } = await this.cart.priced();
      if (cart.lines.length === 0) throw new ApiException('validation', 'Your cart is empty.');
      if (cart.blocked) throw new ApiException('validation', 'Some items in your cart are out of stock. Remove them to continue.');
      if (request.paymentMethod === 'cod') {
        const cod = codEligibility(request.address.pincode, cart.totals.total.amount);
        if (!cod.enabled) throw new ApiException('validation', cod.reason ?? 'Cash on delivery is not available.');
      }

      // A gift card or store credit may pay part or all of the order (BRD 14, PE-05).
      const giftCardPaid = cart.totals.giftCardApplied?.amount ?? 0;
      const creditPaid = cart.totals.creditApplied?.amount ?? 0;
      const tender: Order['tender'] | undefined =
        giftCardPaid > 0 || creditPaid > 0 ? { ...(giftCardPaid > 0 && cart.giftCardCode ? { giftCard: { code: cart.giftCardCode, amount: giftCardPaid } } : {}), ...(creditPaid > 0 ? { storeCredit: creditPaid } : {}) } : undefined;
      const covered = !!tender && cart.totals.total.amount === 0;
      const now = new Date().toISOString();
      const cod = request.paymentMethod === 'cod';
      // Settled orders are confirmed right away: cash on delivery, or fully covered by the wallet.
      const settled = cod || covered;
      const order: Order = {
        id: newOrderId(),
        status: settled ? 'confirmed' : 'pending_payment',
        paymentStatus: covered ? 'paid' : cod ? 'cod' : 'pending',
        paymentMethod: request.paymentMethod,
        lines: cart.lines,
        totals: cart.totals,
        ...(cart.coupon ? { couponCode: cart.coupon.code } : {}),
        ...(cart.promotions?.length ? { promotions: cart.promotions } : {}),
        ...(tender ? { tender } : {}),
        ...(Object.keys(this.attribution.touches()).length ? { attribution: this.attribution.touches() } : {}),
        shippingMethod: cart.shippingMethod,
        contact: request.contact,
        address: request.address,
        createdAt: now,
        ...(this.users.currentUserId() ? { userId: this.users.currentUserId() as string } : {}),
        timeline: [
          { status: 'placed', label: 'Order placed', at: now },
          ...(covered ? [{ status: 'paid' as const, label: 'Paid with gift card or store credit', at: now }] : []),
          ...(settled ? [{ status: 'confirmed' as const, label: 'Order confirmed', at: now }] : []),
        ],
      };
      // Stock is claimed before the order exists, so two shoppers can never both get the last unit.
      const stockLines = cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
      if (settled) this.inventory.sell(order.id, stockLines, products, 'Checkout');
      else this.inventory.reserve(order.id, stockLines, products);
      try {
        this.wallet.redeem(order, 'Customer');
      } catch (e) {
        if (settled) this.inventory.restore(order.id, products);
        else this.inventory.release(order.id, products);
        throw new ApiException('validation', e instanceof Error ? e.message : 'Could not use your gift card or store credit.');
      }
      this.store.save(order);
      // A cart with marketplace items becomes one shipment per seller, each with its own status and tracking (BRD 17).
      this.sellers.createShipments(order);
      this.store.rememberKey(request.idempotencyKey, order.id);
      const userId = this.users.currentUserId() ?? undefined;
      if (settled) {
        this.cart.write({ ...EMPTY_STORED_CART, items: [], shippingMethod: cart.shippingMethod });
        if (covered) this.notifications.deliver('order_paid', order.contact.email, { name: order.contact.name, orderId: order.id }, { userId, link: `/orders/${order.id}` });
        else this.notifications.deliver('order_placed', order.contact.email, { name: order.contact.name, orderId: order.id, total: formatMoney(order.totals.total) }, { userId, link: `/orders/${order.id}` });
      } else if (userId) {
        this.notifications.notify(userId, 'order', 'Order placed', `Order ${order.id} is placed. Complete your payment to confirm it.`, `/orders/${order.id}`);
      }
      return this.sellers.applyShipments(order);
    });
  }

  get(orderId: string) {
    return this.respond.okAsync<Order>(async () => {
      await this.sweep();
      const order = this.store.find(orderId);
      if (!order) throw new ApiException('not_found', 'Order not found');
      return this.sellers.applyShipments(withProgress(order, Date.now()));
    });
  }

  list() {
    return this.respond.okAsync<Order[]>(async () => {
      await this.sweep();
      // Signed-in customers see their own orders; guests see the orders placed on this device.
      const userId = this.users.currentUserId();
      return this.store.all().filter((o) => (userId ? o.userId === userId : !o.userId)).map((o) => this.sellers.applyShipments(withProgress(o, Date.now())));
    });
  }

  cancel(orderId: string) {
    return this.respond.okAsync<Order>(async () => {
      const products = await this.sweep();
      const found = this.store.find(orderId);
      if (!found) throw new ApiException('not_found', 'Order not found');
      const order = withProgress(found, Date.now());
      if (order.status === 'cancelled') return order;
      if (order.status === 'shipped' || order.status === 'delivered') throw new ApiException('validation', 'This order has already shipped and can no longer be cancelled.');
      // Unpaid orders only hold a reservation; paid or cash-on-delivery orders have sold units to put back.
      if (found.status === 'pending_payment') this.inventory.release(orderId, products);
      else this.inventory.restore(orderId, products);
      const cancelled: Order = this.wallet.refund({
        ...found,
        status: 'cancelled',
        // A fully gift-card-paid order has no bank refund pending: its balance was put back above.
        paymentStatus: found.paymentStatus === 'paid' && found.totals.total.amount > 0 ? 'refund_pending' : found.paymentStatus,
        timeline: [...found.timeline.filter((t) => t.status === 'placed' || t.status === 'paid' || t.status === 'confirmed'), { status: 'cancelled', label: 'Order cancelled', at: new Date().toISOString() }],
      }, 'Customer');
      this.store.save(cancelled);
      this.sellers.cancelShipments(cancelled.id);
      this.notifications.deliver('order_cancelled', cancelled.contact.email, { name: cancelled.contact.name, orderId: cancelled.id }, { userId: this.users.currentUserId() ?? undefined, link: `/orders/${cancelled.id}` });
      return cancelled;
    });
  }
}
