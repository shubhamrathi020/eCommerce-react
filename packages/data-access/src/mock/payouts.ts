import { Injectable, inject } from '@shop/core';
import type { PayoutPreview, StatementAdjustment, StatementLine } from '@ecom/contracts';
import { ApiException, commissionPercent, splitCommission, statementTotals } from '@ecom/contracts';
import { loadCatalogData } from './catalog-data';
import { MockOrderStore } from './mock-order-store';
import { MockReturnStore } from './return-store';
import { MockSellerStore } from './seller-store';

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Validates a yyyy-mm-dd period; throws a field error otherwise. */
export function checkPeriod(from: string, to: string, maxDays = 400): { fromMs: number; toMs: number } {
  const fields: Record<string, string> = {};
  const parse = (v: string, end: boolean) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T${end ? '23:59:59.999' : '00:00:00'}Z`) : Number.NaN);
  const fromMs = parse(from, false);
  const toMs = parse(to, true);
  if (Number.isNaN(fromMs)) fields['from'] = 'Choose a start date';
  if (Number.isNaN(toMs)) fields['to'] = 'Choose an end date';
  if (!fields['from'] && !fields['to'] && toMs < fromMs) fields['to'] = 'The end cannot be before the start';
  if (!fields['from'] && !fields['to'] && toMs - fromMs > maxDays * DAY) fields['to'] = 'A statement covers at most 13 months';
  if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
  return { fromMs, toMs };
}

/**
 * Works out what a seller is owed (MP-03): the shopper-paid value of the seller's delivered shipments, less commission, and minus
 * returns that were refunded. It reads delivered shipments and refunded returns directly, so a statement reconciles with the orders
 * it came from. Shipments and returns already on an issued statement are never counted twice.
 */
@Injectable({ providedIn: 'root' })
export class PayoutCalculator {
  private readonly sellers = inject(MockSellerStore);
  private readonly orders = inject(MockOrderStore);
  private readonly returns = inject(MockReturnStore);

  /** `openEnded` skips the 13-month limit, for a seller's "everything not yet paid" view. */
  async preview(sellerId: string, from: string, to: string, openEnded = false): Promise<PayoutPreview> {
    const { fromMs, toMs } = checkPeriod(from, to, openEnded ? 100_000 : 400);
    const seller = this.sellers.seller(sellerId);
    if (!seller) throw new ApiException('not_found', 'Seller not found');
    const { products } = await loadCatalogData();
    const byId = new Map(products.map((p) => [p.id, p]));
    const rules = this.sellers.rules();
    const percentFor = (productId: string) => commissionPercent(rules, seller, (byId.get(productId)?.categoryPath ?? []).map((c) => c.id));
    const discountShare = (orderId: string, value: number): number => {
      const order = this.orders.find(orderId);
      const subtotal = order?.totals.subtotal.amount ?? 0;
      const discount = (order?.totals.couponDiscount.amount ?? 0) + (order?.totals.promotionDiscount?.amount ?? 0);
      return subtotal > 0 ? Math.round((discount * value) / subtotal) : 0;
    };

    const lines: StatementLine[] = [];
    for (const sh of this.sellers.shipments()) {
      if (sh.sellerId !== sellerId || sh.status !== 'delivered' || sh.statementId) continue;
      const deliveredAt = sh.timeline.find((t) => t.status === 'delivered')?.at;
      const at = deliveredAt ? Date.parse(deliveredAt) : Number.NaN;
      if (Number.isNaN(at) || at < fromMs || at > toMs) continue;
      const order = this.orders.find(sh.orderId);
      if (!order) continue;
      let gross = 0;
      let commission = 0;
      for (const l of order.lines.filter((x) => sh.variantIds.includes(x.variantId))) {
        const g = l.lineTotal.amount - discountShare(order.id, l.lineTotal.amount);
        gross += g;
        commission += splitCommission(g, percentFor(l.productId)).commission;
      }
      lines.push({ shipmentId: sh.id, orderId: sh.orderId, deliveredAt: deliveredAt as string, gross, percent: gross > 0 ? round2((commission / gross) * 100) : 0, commission, net: gross - commission });
    }

    // Refunded returns of this seller's items reverse the sale, and hand the commission on them back.
    const alreadyAdjusted = new Set(this.sellers.statements().flatMap((s) => s.adjustments.map((a) => a.returnId)));
    const adjustments: StatementAdjustment[] = [];
    for (const r of this.returns.read().returns) {
      if (r.status !== 'refunded' || !r.refundedAt || alreadyAdjusted.has(r.id)) continue;
      const at = Date.parse(r.refundedAt);
      if (at < fromMs || at > toMs) continue;
      let gross = 0;
      let commission = 0;
      for (const item of r.items.filter((i) => this.sellers.ownerOf(i.productId) === sellerId)) {
        const value = item.unitPrice.amount * item.quantity;
        const g = value - discountShare(r.orderId, value);
        gross += g;
        commission += splitCommission(g, percentFor(item.productId)).commission;
      }
      if (gross === 0) continue;
      adjustments.push({ returnId: r.id, orderId: r.orderId, refundedAt: r.refundedAt, gross: -gross, percent: round2((commission / gross) * 100), commission: -commission, net: -(gross - commission) });
    }
    return { sellerId, sellerName: seller.displayName, from, to, lines, adjustments, ...statementTotals(lines, adjustments) };
  }
}
