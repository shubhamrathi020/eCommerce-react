import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import { giftCardProblem } from '@ecom/contracts';
import { loadCatalogData } from './catalog-data';
import { MockInventoryStore } from './inventory-store';
import { MockOrderStore } from './mock-order-store';
import { MockPromotionStore } from './promotion-store';
import { MockReturnStore } from './return-store';
import { EMPTY_STORED_CART, MAX_LINE_QUANTITY, type PricedCart, type PricingExtras, type StoredCart, priceCart } from './cart-engine';
import { MockUserStore } from './mock-user-store';

const GUEST_KEY = 'ecom.mock.cart.v1';
const userKey = (userId: string) => `ecom.mock.cart.user.${userId}.v1`;

/** Device-local cart storage for the mock adapters (a real backend keeps this server-side). */
@Injectable({ providedIn: 'root' })
export class MockCartState {
  private readonly storage = inject(STORAGE);
  private readonly users = inject(MockUserStore);
  private readonly inventory = inject(MockInventoryStore);
  private readonly promotions = inject(MockPromotionStore);
  private readonly orders = inject(MockOrderStore);
  private readonly returns = inject(MockReturnStore);

  /** Guests use one device-wide cart; signed-in customers have their own. */
  private key(): string {
    const id = this.users.currentUserId();
    return id ? userKey(id) : GUEST_KEY;
  }

  /** Moves guest cart items into the customer's cart (quantities add up, capped) and empties the guest cart. */
  mergeGuestIntoUser(userId: string): void {
    const guest = this.readKey(GUEST_KEY);
    if (guest.items.length === 0) return;
    const mine = this.readKey(userKey(userId));
    const items = mine.items.map((i) => ({ ...i }));
    for (const g of guest.items) {
      const existing = items.find((i) => i.variantId === g.variantId);
      if (existing) existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + g.quantity);
      else items.push({ ...g });
    }
    this.writeKey(userKey(userId), { ...mine, items });
    this.writeKey(GUEST_KEY, { ...EMPTY_STORED_CART, items: [] });
  }

  removeUserCart(userId: string): void {
    this.storage.removeItem(userKey(userId));
  }

  read(): StoredCart {
    return this.readKey(this.key());
  }

  private readKey(key: string): StoredCart {
    try {
      const raw = this.storage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as StoredCart) : null;
      if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch {
      // Corrupt data: start with an empty cart.
    }
    return { ...EMPTY_STORED_CART, items: [] };
  }

  write(cart: StoredCart): void {
    this.writeKey(this.key(), cart);
  }

  private writeKey(key: string, cart: StoredCart): void {
    try {
      this.storage.setItem(key, JSON.stringify(cart));
    } catch {
      // Storage full or blocked; the in-memory response is still correct.
    }
  }

  /**
   * What the price engine needs besides the cart (BRD 14): live promotions, how many orders this shopper has placed,
   * how many flash-deal units are left, and the wallet (gift card and store credit). Pricing itself stays in the engine.
   */
  extrasFor(stored: StoredCart, now = Date.now()): PricingExtras {
    const userId = this.users.currentUserId();
    const orders = this.orders.all();
    const promotions = this.promotions.promotions(now);
    const mine = orders.filter((o) => o.status !== 'cancelled' && (userId ? o.userId === userId : !o.userId));
    const code = stored.giftCardCode;
    const card = code ? this.promotions.giftCard(code) : undefined;
    return {
      promotions,
      context: { priorOrders: mine.length, flashRemaining: this.promotions.flashRemaining(orders, promotions) },
      wallet: {
        ...(code ? { giftCard: card ? { code, balance: card.balance, ...(giftCardProblem(card, now) ? { problem: giftCardProblem(card, now) as string } : {}) } : undefined } : {}),
        credit: userId ? (this.returns.read().credit[userId] ?? 0) : 0,
      },
    };
  }

  /** Prices the stored cart against the catalog and saves the cleaned-up result. */
  async priced(): Promise<PricedCart> {
    const { products } = await loadCatalogData();
    const stored = this.read();
    const result = priceCart(stored, this.inventory.apply(products), Date.now(), this.extrasFor(stored));
    this.write(result.stored);
    return result;
  }

  /**
   * Applies a change, then acknowledges current prices (so a price-change notice is shown once)
   * and returns the freshly priced cart.
   */
  async mutate(change: (stored: StoredCart, catalog: Awaited<ReturnType<typeof loadCatalogData>>) => StoredCart): Promise<PricedCart> {
    const loaded = await loadCatalogData();
    const catalog = { ...loaded, products: this.inventory.apply(loaded.products) };
    const next = change(this.read(), catalog);
    const acknowledged: StoredCart = {
      ...next,
      items: next.items.map((item) => {
        const variant = catalog.products.flatMap((p) => p.variants).find((v) => v.id === item.variantId);
        return variant ? { ...item, seenPrice: variant.price.amount } : item;
      }),
    };
    const result = priceCart(acknowledged, catalog.products, Date.now(), this.extrasFor(acknowledged));
    this.write(result.stored);
    return result;
  }
}
