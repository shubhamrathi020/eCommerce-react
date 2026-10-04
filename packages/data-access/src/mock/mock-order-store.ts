import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { Order, OrderStatus, Product, TimelineEntry } from '@ecom/contracts';
import type { MockInventoryStore } from './inventory-store';

const ORDERS_KEY = 'ecom.mock.orders.v1';
const IDEMPOTENCY_KEY = 'ecom.mock.idempotency.v1';
const MINUTE = 60_000;

/** Mock orders progress on their own so the tracking page has something to show. */
const PROGRESS: { status: OrderStatus; label: string; afterMinutes: number }[] = [
  { status: 'packed', label: 'Packed', afterMinutes: 1 },
  { status: 'shipped', label: 'Shipped', afterMinutes: 3 },
  { status: 'delivered', label: 'Delivered', afterMinutes: 6 },
];

/** Device-local order storage (mock only; labelled `mock` so it is never mistaken for real customer data). */
@Injectable({ providedIn: 'root' })
export class MockOrderStore {
  private readonly storage = inject(STORAGE);

  all(): Order[] {
    return this.readJson<Order[]>(ORDERS_KEY, []);
  }

  save(order: Order): void {
    const others = this.all().filter((o) => o.id !== order.id);
    this.writeJson(ORDERS_KEY, [order, ...others]);
  }

  /** Account deletion: keep the order for accounting, drop the personal links. */
  anonymise(userId: string): void {
    const cleaned = this.all().map((o) => {
      if (o.userId !== userId) return o;
      const { userId: _removed, ...rest } = o;
      return { ...rest, contact: { name: 'Deleted customer', email: '', phone: '' }, address: { line1: 'Removed', city: '', state: '', pincode: o.address.pincode } };
    });
    this.writeJson(ORDERS_KEY, cleaned);
  }

  find(id: string): Order | undefined {
    return this.all().find((o) => o.id === id);
  }

  orderIdForKey(key: string): string | undefined {
    return this.readJson<Record<string, string>>(IDEMPOTENCY_KEY, {})[key];
  }

  rememberKey(key: string, orderId: string): void {
    this.writeJson(IDEMPOTENCY_KEY, { ...this.readJson<Record<string, string>>(IDEMPOTENCY_KEY, {}), [key]: orderId });
  }

  private readJson<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeJson(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked.
    }
  }
}

/** Cancels unpaid orders whose stock reservation ran out, so abandoned payments free their units. */
/** `onCancel` lets the caller undo anything else the order held, e.g. a gift card, and returns the order to save. */
export function cancelExpiredOrders(orders: MockOrderStore, inventory: MockInventoryStore, products: Product[], now = Date.now(), onCancel?: (order: Order) => Order): void {
  for (const id of inventory.expire(products, now)) {
    const order = orders.find(id);
    if (order?.status !== 'pending_payment') continue;
    const cancelled: Order = { ...order, status: 'cancelled', paymentStatus: 'failed', timeline: [...order.timeline, { status: 'cancelled', label: 'Cancelled: payment window expired', at: new Date(now).toISOString() }] };
    orders.save(onCancel ? onCancel(cancelled) : cancelled);
  }
}

/** Fills in the fulfilment steps that have happened by `now`. Cancelled and unpaid orders do not progress. */
export function withProgress(order: Order, now: number): Order {
  if (order.status === 'cancelled' || order.status === 'pending_payment') return order;
  const confirmed = order.timeline.find((t) => t.status === 'confirmed');
  const base = confirmed?.at ? new Date(confirmed.at).getTime() : new Date(order.createdAt).getTime();
  let status: OrderStatus = order.status;
  const timeline: TimelineEntry[] = order.timeline.filter((t) => !PROGRESS.some((p) => p.status === t.status));
  for (const step of PROGRESS) {
    const at = base + step.afterMinutes * MINUTE;
    if (now >= at) {
      status = step.status;
      timeline.push({ status: step.status, label: step.label, at: new Date(at).toISOString() });
    } else {
      timeline.push({ status: step.status, label: step.label });
    }
  }
  return { ...order, status, timeline };
}
