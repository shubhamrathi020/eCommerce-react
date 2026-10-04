import { Injectable, inject } from '@shop/core';
import type { GiftCard, IssueGiftCardInput, PriceHealthIssue, Promotion, PromotionInput, SimulationInput, SimulationResult } from '@ecom/contracts';
import { ApiException, MAX_CREDIBLE_DISCOUNT_PERCENT, isCredibleReference } from '@ecom/contracts';
import { formatMoney } from '@shop/core';
import { AdminGiftCardApi, AdminPromotionApi } from '../../lib/promotion.api';
import { loadCatalogData } from '../catalog-data';
import { priceCart } from '../cart-engine';
import { createMockResponder } from '../mock-latency';
import { MockOrderStore } from '../mock-order-store';
import { MockPromotionStore } from '../promotion-store';
import { MockAdminState } from './admin-state';
import { loadProducts } from './mock-admin.api';

const int = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
let counter = 0;
const newId = () => `promo-${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Field-level checks for a promotion form. Returns `{}` when it is valid. */
export function promotionProblems(input: PromotionInput, productPrice: (productId: string) => number | undefined): Record<string, string> {
  const f: Record<string, string> = {};
  if (!input.name?.trim()) f['name'] = 'Give the promotion a name';
  else if (input.name.length > 80) f['name'] = 'At most 80 characters';
  if (!int(input.priority) || input.priority < 0 || input.priority > 100) f['priority'] = 'Enter a whole number from 0 to 100';
  const start = input.startsAt ? new Date(input.startsAt).getTime() : undefined;
  const end = input.endsAt ? new Date(input.endsAt).getTime() : undefined;
  if (input.startsAt && Number.isNaN(start)) f['startsAt'] = 'Enter a valid date';
  if (input.endsAt && Number.isNaN(end)) f['endsAt'] = 'Enter a valid date';
  if (start !== undefined && end !== undefined && !Number.isNaN(start) && !Number.isNaN(end) && end <= start) f['endsAt'] = 'The end must be after the start';
  switch (input.kind) {
    case 'buy_x_get_y':
      if (!int(input.buy) || input.buy < 1 || input.buy > 10) f['buy'] = 'Enter a whole number from 1 to 10';
      if (!int(input.get) || input.get < 1 || input.get > 10) f['get'] = 'Enter a whole number from 1 to 10';
      if (!int(input.percentOff) || input.percentOff < 1 || input.percentOff > 100) f['percentOff'] = 'Enter a percentage from 1 to 100';
      break;
    case 'tiered': {
      const tiers = input.tiers ?? [];
      if (tiers.length === 0) f['tiers'] = 'Add at least one tier';
      else if (tiers.some((t) => !int(t.min) || t.min < 1 || !int(t.percent) || t.percent < 1 || t.percent > 90)) f['tiers'] = 'Each tier needs a positive threshold and a percentage from 1 to 90';
      else if (tiers.some((t, i) => i > 0 && t.min <= tiers[i - 1].min)) f['tiers'] = 'Thresholds must increase from one tier to the next';
      break;
    }
    case 'category_sale':
      if (!input.categoryIds?.length) f['categoryIds'] = 'Choose at least one category';
      if (!int(input.percent) || input.percent < 1 || input.percent > 90) f['percent'] = 'Enter a percentage from 1 to 90';
      break;
    case 'flash': {
      const price = productPrice(input.productId);
      if (!input.productId?.trim()) f['productId'] = 'Enter a product id';
      else if (price === undefined) f['productId'] = 'No product with that id';
      if (!int(input.dealPrice) || input.dealPrice < 1) f['dealPrice'] = 'Enter the deal price in rupees';
      else if (price !== undefined && input.dealPrice >= price) f['dealPrice'] = `The deal price must be below the current price (${formatMoney({ amount: price, currency: 'INR' })})`;
      if (!int(input.cap) || input.cap < 1 || input.cap > 10_000) f['cap'] = 'Enter a whole number from 1 to 10,000';
      if (input.perOrderLimit !== undefined && (!int(input.perOrderLimit) || input.perOrderLimit < 1)) f['perOrderLimit'] = 'Enter a whole number, or leave empty';
      if (!input.endsAt) f['endsAt'] = 'A flash deal needs an end time for its countdown';
      break;
    }
  }
  return f;
}

@Injectable()
export class MockAdminPromotionApi extends AdminPromotionApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockPromotionStore);
  private readonly orders = inject(MockOrderStore);

  list() {
    return this.respond.okAsync<Promotion[]>(async () => {
      this.state.require('promotion:manage');
      return this.store.promotions();
    });
  }

  save(input: PromotionInput) {
    return this.respond.okAsync<Promotion>(async () => {
      this.state.require('promotion:manage');
      const { products } = await loadCatalogData();
      const fields = promotionProblems(input, (id) => products.find((p) => p.id === id)?.variants[0].price.amount);
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const id = input.id ?? newId();
      // Strip server-owned fields; an edited promotion is no longer "demo" data.
      const { id: _id, demo: _demo, ...rest } = input as PromotionInput & { demo?: boolean };
      const saved = { ...rest, id, name: input.name.trim() } as Promotion;
      this.store.savePromotions((list) => (list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? saved : p)) : [...list, saved]));
      this.state.record(input.id ? 'promotion.update' : 'promotion.create', id, `${saved.kind}: ${saved.name}`);
      return saved;
    });
  }

  setEnabled(id: string, enabled: boolean) {
    return this.respond.okAsync<Promotion>(async () => {
      this.state.require('promotion:manage');
      let found: Promotion | undefined;
      this.store.savePromotions((list) =>
        list.map((p) => {
          if (p.id !== id) return p;
          found = { ...p, enabled };
          return found;
        }),
      );
      if (!found) throw new ApiException('not_found', 'Promotion not found');
      this.state.record(enabled ? 'promotion.enable' : 'promotion.pause', id, found.name);
      return found;
    });
  }

  remove(id: string) {
    return this.respond.okAsync<void>(async () => {
      this.state.require('promotion:manage');
      const existing = this.store.promotions().find((p) => p.id === id);
      if (!existing) throw new ApiException('not_found', 'Promotion not found');
      this.store.savePromotions((list) => list.filter((p) => p.id !== id));
      this.state.record('promotion.delete', id, existing.name);
    });
  }

  simulate(input: SimulationInput) {
    return this.respond.okAsync<SimulationResult>(async () => {
      this.state.require('promotion:manage');
      const { products } = await loadCatalogData();
      const at = input.at ? new Date(input.at).getTime() : Date.now();
      if (Number.isNaN(at)) throw new ApiException('validation', 'Enter a valid date and time.', { at: 'Enter a valid date and time' });
      const items = input.items.filter((i) => i.quantity > 0);
      if (items.length === 0) throw new ApiException('validation', 'Add at least one item to the sample cart.', { items: 'Add at least one item' });
      const variants = products.flatMap((p) => p.variants);
      const stored = {
        items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, seenPrice: variants.find((v) => v.id === i.variantId)?.price.amount ?? 0 })),
        shippingMethod: 'standard' as const,
        ...(input.couponCode?.trim() ? { couponCode: input.couponCode.trim() } : {}),
      };
      const promotions = this.store.promotions(at);
      // The simulator never touches real stock or real orders: flash caps are read, not consumed.
      const { cart, trace } = priceCart(stored, products, at, {
        promotions,
        context: { priorOrders: input.priorOrders, flashRemaining: this.store.flashRemaining(this.orders.all(), promotions) },
      });
      const couponNote = cart.notices.find((n) => n.startsWith('Coupon'));
      return {
        subtotal: cart.totals.subtotal,
        promotionDiscount: cart.totals.promotionDiscount ?? { amount: 0, currency: 'INR' },
        couponDiscount: cart.totals.couponDiscount,
        ...(couponNote ? { couponNote } : {}),
        shipping: cart.totals.shipping,
        total: cart.totals.total,
        applied: cart.promotions ?? [],
        trace,
      };
    });
  }

  priceHealth() {
    return this.respond.okAsync<PriceHealthIssue[]>(async () => {
      this.state.require('promotion:manage');
      const out: PriceHealthIssue[] = [];
      for (const { product } of await loadProducts(this.state)) {
        for (const v of product.variants) {
          if (!v.mrp || v.mrp.amount === v.price.amount) continue;
          const base = { productId: product.id, variantId: v.id, sku: v.sku, title: product.title, price: v.price, mrp: v.mrp };
          if (v.mrp.amount < v.price.amount) out.push({ ...base, problem: 'The MRP is lower than the selling price' });
          else if (!isCredibleReference(v.price.amount, v.mrp.amount)) out.push({ ...base, problem: `The MRP is more than ${MAX_CREDIBLE_DISCOUNT_PERCENT}% above the selling price, so no discount label is shown` });
        }
      }
      return out;
    });
  }
}

@Injectable()
export class MockAdminGiftCardApi extends AdminGiftCardApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockPromotionStore);

  list() {
    return this.respond.okAsync<GiftCard[]>(async () => {
      this.state.require('promotion:manage');
      return [...this.store.giftCards()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  issue(input: IssueGiftCardInput) {
    return this.respond.okAsync<GiftCard>(async () => {
      const actor = this.state.require('promotion:manage');
      const fields: Record<string, string> = {};
      if (!Number.isInteger(input.amount) || input.amount < 10_000 || input.amount > 5_000_000) fields['amount'] = 'Enter an amount from ₹100 to ₹50,000';
      const code = (input.code?.trim() || `GC${Math.random().toString(36).slice(2, 10).toUpperCase()}`).toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(code)) fields['code'] = 'Use 4 to 20 letters, digits or hyphens';
      let expiresAt: string | undefined;
      if (input.expiresOn) {
        const t = new Date(`${input.expiresOn}T23:59:59Z`).getTime();
        if (Number.isNaN(t) || t < Date.now()) fields['expiresOn'] = 'Choose a date in the future';
        else expiresAt = new Date(t).toISOString();
      }
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const at = new Date().toISOString();
      const card: GiftCard = {
        code,
        initialAmount: input.amount,
        balance: input.amount,
        ...(input.issuedTo?.trim() ? { issuedTo: input.issuedTo.trim().slice(0, 80) } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        status: 'active',
        createdAt: at,
        entries: [{ id: `gce_${Date.now().toString(36)}`, at, type: 'issue', amount: input.amount, actor: actor.name }],
      };
      this.store.transactCards((cards) => {
        if (cards.some((c) => c.code === code)) throw new ApiException('conflict', 'A gift card with that code already exists.', { code: 'Already in use' });
        cards.push(card);
      });
      this.state.record('giftcard.issue', code, formatMoney({ amount: input.amount, currency: 'INR' }));
      return card;
    });
  }

  setStatus(code: string, status: GiftCard['status']) {
    return this.respond.okAsync<GiftCard>(async () => {
      this.state.require('promotion:manage');
      const card = this.store.transactCards((cards) => {
        const found = cards.find((c) => c.code === code);
        if (!found) throw new ApiException('not_found', 'Gift card not found');
        found.status = status;
        return found;
      });
      this.state.record(status === 'active' ? 'giftcard.enable' : 'giftcard.disable', code, '');
      return card;
    });
  }
}
