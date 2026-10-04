import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { AttachmentMeta, Order, OrderRefund, Product, ReturnEligibility, ReturnLineEligibility, ReturnPolicy, ReturnRequest, SupportTicket } from '@ecom/contracts';
import { ApiException, DEFAULT_RETURN_POLICY, OPEN_RETURN_STATUSES, attachmentProblem } from '@ecom/contracts';

const KEY = 'ecom.mock.returns.v1';
const DAY = 86_400_000;

interface ReturnState {
  returns: ReturnRequest[];
  tickets: SupportTicket[];
  policy: ReturnPolicy;
  /** Store credit balance in paise per user. */
  credit: Record<string, number>;
  /** Refund records for cancelled prepaid orders, keyed by order id. */
  orderRefunds: Record<string, OrderRefund>;
}

const emptyState = (): ReturnState => ({ returns: [], tickets: [], policy: { ...DEFAULT_RETURN_POLICY }, credit: {}, orderRefunds: {} });

let counter = 0;
export const newReturnId = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

/** Device-local returns, refunds, store credit and support tickets (mock only). The shop and the admin mocks share it. */
@Injectable({ providedIn: 'root' })
export class MockReturnStore {
  private readonly storage = inject(STORAGE);

  read(): ReturnState {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { ...emptyState(), ...(JSON.parse(raw) as Partial<ReturnState>) } : emptyState();
    } catch {
      return emptyState();
    }
  }

  private write(state: ReturnState): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked.
    }
  }

  /** Reads, changes and saves in one synchronous step; nothing is saved when `change` throws. */
  transact<T>(change: (state: ReturnState) => T): T {
    const state = this.read();
    const result = change(state);
    this.write(state);
    return result;
  }

  policy(): ReturnPolicy {
    return this.read().policy;
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * What can still be returned from `order` right now. `order` must already have its fulfilment progress applied.
 * Rules (RF-01): delivered only; inside the window counted from the delivery time; not in a non-returnable category or product;
 * and units that sit in an open request, or were already refunded, can't be chosen again.
 */
export function eligibilityFor(order: Order, returns: ReturnRequest[], policy: ReturnPolicy, products: Product[], now: number): ReturnEligibility {
  const delivered = order.timeline.find((t) => t.status === 'delivered' && t.at)?.at;
  const mine = returns.filter((r) => r.orderId === order.id);
  const windowEnd = delivered ? new Date(delivered).getTime() + policy.windowDays * DAY : undefined;
  let orderReason: string | undefined;
  if (order.status !== 'delivered' || !delivered) orderReason = 'Only delivered orders can be returned.';
  else if (windowEnd !== undefined && now > windowEnd) orderReason = `The ${policy.windowDays}-day return window ended on ${dateOnly(windowEnd)}.`;

  const lines = order.lines.map((line): ReturnLineEligibility => {
    const own = mine.filter((r) => r.items.some((i) => i.variantId === line.variantId));
    const qtyOf = (r: ReturnRequest) => r.items.find((i) => i.variantId === line.variantId)?.quantity ?? 0;
    const returned = own.filter((r) => r.status === 'refunded').reduce((n, r) => n + qtyOf(r), 0);
    const inOpenRequest = own.filter((r) => OPEN_RETURN_STATUSES.includes(r.status)).reduce((n, r) => n + qtyOf(r), 0);
    const product = products.find((p) => p.id === line.productId);
    const excluded = policy.excludedProductIds.includes(line.productId) || (product ? [product.categoryId, ...product.categoryPath.map((c) => c.id)].some((id) => policy.excludedCategoryIds.includes(id)) : false);
    let blockedReason: string | undefined;
    if (orderReason) blockedReason = orderReason;
    else if (excluded) blockedReason = 'This item cannot be returned.';
    else if (inOpenRequest > 0) blockedReason = 'A return request for this item is already open.';
    else if (returned >= line.quantity) blockedReason = 'Already returned.';
    const returnable = blockedReason ? 0 : line.quantity - returned;
    return { variantId: line.variantId, title: line.title, options: line.options, image: line.image, unitPrice: line.unitPrice, ordered: line.quantity, returned, inOpenRequest, returnable, ...(blockedReason ? { blockedReason } : {}) };
  });

  const eligible = lines.some((l) => l.returnable > 0);
  return {
    orderId: order.id,
    ...(delivered ? { deliveredAt: delivered } : {}),
    ...(windowEnd !== undefined ? { windowEndsAt: iso(windowEnd) } : {}),
    eligible,
    ...(!eligible ? { reason: orderReason ?? lines.find((l) => l.blockedReason)?.blockedReason ?? 'Nothing in this order can be returned.' } : {}),
    windowDays: policy.windowDays,
    returnFee: { amount: policy.returnFee, currency: 'INR' },
    lines,
  };
}

/** Maximum lengths shared by the forms and the checks. */
export const RETURN_LIMITS = { comments: 500, rejection: 300, note: 300 } as const;

/** Throws a field error for attachments that break the type/size/count rules (RF-08). */
export function checkAttachments(files: readonly AttachmentMeta[] | undefined): AttachmentMeta[] {
  const list = (files ?? []).map((f) => ({ name: String(f.name).slice(0, 120), type: String(f.type), size: Number(f.size) }));
  const problem = attachmentProblem(list);
  if (problem) throw new ApiException('validation', problem, { attachments: problem });
  return list;
}
