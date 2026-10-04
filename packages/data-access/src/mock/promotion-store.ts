import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { GiftCard, GiftCardEntry, Order, Promotion } from '@ecom/contracts';
import { giftCardProblem } from '@ecom/contracts';
import { MockReturnStore } from './return-store';

const KEY = 'ecom.mock.promotions.v1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface PromotionState {
  /** Null until an admin first saves; until then the seeded demo set is used. */
  promotions: Promotion[] | null;
  giftCards: GiftCard[] | null;
}

const demo = { enabled: true, demo: true } as const;

/** The promotions that ship with the mock so every rule type can be tried. Dates roll forward (see `rollDemo`). */
export function seedPromotions(now: number): Promotion[] {
  const window = { startsAt: new Date(now - HOUR).toISOString(), endsAt: new Date(now + 3 * DAY).toISOString() };
  return [
    { ...demo, id: 'promo-snack-bogo', name: 'Snack attack', description: 'Buy 2 snacks, get the third free', kind: 'buy_x_get_y', buy: 2, get: 1, percentOff: 100, categoryIds: ['cat-snacks'], priority: 10, segment: 'all', stacking: 'stackable' },
    { ...demo, id: 'promo-fashion-sale', name: 'Fashion fest', description: '10% off all fashion', kind: 'category_sale', categoryIds: ['cat-fashion'], percent: 10, priority: 5, segment: 'all', stacking: 'stackable' },
    { ...demo, id: 'promo-electronics-tiers', name: 'Electronics bonanza', description: 'Spend more on electronics, save more', kind: 'tiered', basis: 'subtotal', categoryIds: ['cat-electronics'], tiers: [{ min: 1_000_000, percent: 5 }, { min: 3_000_000, percent: 8 }], priority: 8, segment: 'all', stacking: 'exclusive' },
    { ...demo, id: 'promo-first-order', name: 'Welcome offer', description: '5% off your first order over ₹999', kind: 'tiered', basis: 'subtotal', tiers: [{ min: 99_900, percent: 5 }], priority: 3, segment: 'first_order', stacking: 'stackable' },
    { ...demo, id: 'promo-flash-tee', name: 'Flash deal: signature tee', description: 'Limited stock at a special price', kind: 'flash', productId: 'p-0001', dealPrice: 179_900, cap: 20, perOrderLimit: 2, priority: 20, segment: 'all', stacking: 'exclusive', ...window },
  ];
}

export function seedGiftCards(now: number): GiftCard[] {
  const at = new Date(now).toISOString();
  return [{ code: 'GIFT500', initialAmount: 50_000, balance: 50_000, issuedTo: 'Demo gift card', status: 'active', createdAt: at, entries: [{ id: 'gce_seed', at, type: 'issue', amount: 50_000, actor: 'system' }] }];
}

/** Demo flash deals that have ended start a fresh three-day window, so the demo never goes stale. */
function rollDemo(list: Promotion[], now: number): Promotion[] {
  return list.map((p) => (p.demo && p.endsAt && new Date(p.endsAt).getTime() < now ? { ...p, startsAt: new Date(now - HOUR).toISOString(), endsAt: new Date(now + 3 * DAY).toISOString() } : p));
}

let counter = 0;
const entryId = () => `gce_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Device-local promotions and gift cards (mock only). */
@Injectable({ providedIn: 'root' })
export class MockPromotionStore {
  private readonly storage = inject(STORAGE);
  private readonly returns = inject(MockReturnStore);

  private read(): PromotionState {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { promotions: null, giftCards: null, ...(JSON.parse(raw) as Partial<PromotionState>) } : { promotions: null, giftCards: null };
    } catch {
      return { promotions: null, giftCards: null };
    }
  }

  private write(state: PromotionState): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked.
    }
  }

  promotions(now = Date.now()): Promotion[] {
    return rollDemo(this.read().promotions ?? seedPromotions(now), now);
  }

  savePromotions(change: (list: Promotion[]) => Promotion[], now = Date.now()): Promotion[] {
    const state = this.read();
    state.promotions = change(rollDemo(state.promotions ?? seedPromotions(now), now));
    this.write(state);
    return state.promotions;
  }

  giftCards(now = Date.now()): GiftCard[] {
    return this.read().giftCards ?? seedGiftCards(now);
  }

  giftCard(code: string): GiftCard | undefined {
    const wanted = code.trim().toUpperCase();
    return this.giftCards().find((g) => g.code === wanted);
  }

  /** Reads, changes and saves the gift cards in one synchronous step; nothing is saved when `change` throws. */
  transactCards<T>(change: (cards: GiftCard[]) => T, now = Date.now()): T {
    const state = this.read();
    const cards = state.giftCards ?? seedGiftCards(now);
    const result = change(cards);
    state.giftCards = cards;
    this.write(state);
    return result;
  }

  /** Units sold per flash deal, counted from live orders so a cancelled order puts its units back. */
  flashRemaining(orders: Order[], promotions: Promotion[]): Record<string, number> {
    const sold: Record<string, number> = {};
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      for (const a of o.promotions ?? []) if (a.units) sold[a.promotionId] = (sold[a.promotionId] ?? 0) + a.units;
    }
    const out: Record<string, number> = {};
    for (const p of promotions) if (p.kind === 'flash') out[p.id] = Math.max(0, p.cap - (sold[p.id] ?? 0));
    return out;
  }

  // ---------- spending (PE-05) ----------

  /** Takes the order's gift card and store credit amounts. Never goes below zero: throws instead. */
  redeem(order: Order, actor: string): void {
    const { giftCard, storeCredit } = order.tender ?? {};
    if (giftCard) {
      this.transactCards((cards) => {
        const card = cards.find((c) => c.code === giftCard.code);
        const problem = giftCardProblem(card, Date.now());
        if (!card || problem) throw new Error(problem ?? 'Gift card not found');
        if (card.balance < giftCard.amount) throw new Error('The gift card balance has changed. Review your cart.');
        card.balance -= giftCard.amount;
        card.entries = [{ id: entryId(), at: new Date().toISOString(), type: 'redeem', amount: -giftCard.amount, orderId: order.id, actor }, ...card.entries];
      });
    }
    if (storeCredit && order.userId) {
      this.returns.transact((s) => {
        const have = s.credit[order.userId as string] ?? 0;
        if (have < storeCredit) throw new Error('Your store credit balance has changed. Review your cart.');
        s.credit[order.userId as string] = have - storeCredit;
      });
    }
  }

  /** Puts the order's gift card and store credit amounts back (cancelled or expired order). Idempotent through `refundedAt`. */
  refund(order: Order, actor: string): Order {
    if (!order.tender || order.tender.refundedAt) return order;
    const { giftCard, storeCredit } = order.tender;
    if (giftCard) {
      this.transactCards((cards) => {
        const card = cards.find((c) => c.code === giftCard.code);
        if (!card) return;
        card.balance += giftCard.amount;
        card.entries = [{ id: entryId(), at: new Date().toISOString(), type: 'refund', amount: giftCard.amount, orderId: order.id, actor }, ...card.entries];
      });
    }
    if (storeCredit && order.userId) {
      this.returns.transact((s) => {
        s.credit[order.userId as string] = (s.credit[order.userId as string] ?? 0) + storeCredit;
      });
    }
    return { ...order, tender: { ...order.tender, refundedAt: new Date().toISOString() } };
  }
}

export type { GiftCardEntry };
