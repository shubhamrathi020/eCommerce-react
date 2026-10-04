import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { Category, CategoryRef, CommissionRule, Order, OrderStatus, PayoutStatement, Product, Seller, SellerProduct, Shipment, ShipmentStatus } from '@ecom/contracts';
import { SHIPMENT_FLOW, orderStatusFromShipments } from '@ecom/contracts';
import { registerCatalogExtension } from './catalog-data';

const KEY = 'ecom.mock.sellers.v1';
const PLACEHOLDER_IMAGE = '/mock/img/seller-placeholder.svg';

interface SellerState {
  /** Null until something is saved; until then the seeded demo marketplace is used. */
  sellers: Seller[] | null;
  products: SellerProduct[] | null;
  shipments: Shipment[];
  statements: PayoutStatement[];
  rules: CommissionRule[] | null;
}

/** Existing catalog products that the demo sellers own. These keep their real reviews, stock and prices. */
export const SEED_OWNERSHIP: Record<string, string> = {
  'p-0010': 'sel_demo',
  'p-0011': 'sel_demo',
  'p-0012': 'sel_demo',
  'p-0013': 'sel_demo',
  'p-0100': 'sel_acme',
  'p-0101': 'sel_acme',
  'p-0102': 'sel_acme',
  'p-0103': 'sel_acme',
};

export const seedCommissionRules = (): CommissionRule[] => [
  { id: 'rule-default', scope: 'default', percent: 10 },
  { id: 'rule-electronics', scope: 'category', categoryId: 'cat-electronics', percent: 6 },
  { id: 'rule-fashion', scope: 'category', categoryId: 'cat-fashion', percent: 12 },
];

export function seedSellers(now: number): Seller[] {
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const address = { line1: '12 Weavers Lane', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' };
  return [
    {
      id: 'sel_demo',
      ownerUserId: 'usr_demo_seller',
      displayName: 'Urban Threads',
      legalName: 'Urban Threads Private Limited',
      phone: '9810000101',
      gstin: '08ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      address,
      bankHolder: 'Urban Threads Private Limited',
      bankIfsc: 'HDFC0001234',
      bankAccountLast4: '4321',
      policies: { returns: '7-day returns on unworn items with tags.', shipping: 'Ships within 2 working days from Jaipur.' },
      status: 'approved',
      appliedAt: at(60),
      decidedAt: at(58),
      decidedBy: 'Demo Admin',
    },
    {
      id: 'sel_acme',
      ownerUserId: 'usr_seed_seller_2',
      displayName: 'Acme Home & Kitchen',
      legalName: 'Acme Housewares LLP',
      phone: '9810000102',
      gstin: '27AAAPL1234C1ZV',
      pan: 'AAAPL1234C',
      address: { line1: '5 Industrial Estate', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      bankHolder: 'Acme Housewares LLP',
      bankIfsc: 'ICIC0004567',
      bankAccountLast4: '9876',
      policies: { returns: '10-day replacement for manufacturing defects.', shipping: 'Ships within 3 working days from Pune.' },
      status: 'approved',
      commissionRate: 8,
      appliedAt: at(45),
      decidedAt: at(44),
      decidedBy: 'Demo Admin',
    },
    {
      id: 'sel_new',
      ownerUserId: 'usr_seed_applicant',
      displayName: 'Fresh Bazaar',
      legalName: 'Fresh Bazaar Traders',
      phone: '9810000103',
      gstin: '29ABCDE9999K1Z8',
      pan: 'ABCDE9999K',
      address: { line1: '88 Market Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      bankHolder: 'Fresh Bazaar Traders',
      bankIfsc: 'SBIN0001234',
      bankAccountLast4: '1122',
      policies: { returns: 'No returns on perishables.', shipping: 'Same-day dispatch within Bengaluru.' },
      status: 'pending',
      appliedAt: at(2),
    },
  ];
}

export function seedSellerProducts(now: number): SellerProduct[] {
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
  return [
    { id: 'sp-0001', sellerId: 'sel_demo', title: 'Handloom Cotton Kurta', brandName: 'Urban Threads', categoryId: 'cat-men-clothing', description: 'A breathable handloom cotton kurta woven in Jaipur. Machine washable.', price: 189900, mrp: 249900, stock: 40, status: 'approved', createdAt: at(50), updatedAt: at(49) },
    { id: 'sp-0002', sellerId: 'sel_demo', title: 'Block-Print Cotton Dupatta', brandName: 'Urban Threads', categoryId: 'cat-women-clothing', description: 'Hand block-printed cotton dupatta in natural dyes.', price: 79900, stock: 25, status: 'pending', createdAt: at(1), updatedAt: at(1) },
  ];
}

let counter = 0;
export const newSellerId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** A seller's approved listing as a catalog product. */
function toCatalogProduct(sp: SellerProduct, categories: Category[], sellerName: string): Product {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: CategoryRef[] = [];
  for (let c = byId.get(sp.categoryId); c; c = c.parentId ? byId.get(c.parentId) : undefined) path.unshift({ id: c.id, slug: c.slug, name: c.name });
  return {
    id: sp.id,
    slug: `${slugOf(sp.title)}-${sp.id}`,
    title: sp.title,
    brandId: `brand-${slugOf(sp.brandName)}`,
    brandName: sp.brandName,
    categoryId: sp.categoryId,
    categoryPath: path,
    description: `<p>${sp.description.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch] as string)}</p>`,
    highlights: [`Sold by ${sellerName}`],
    images: [{ url: PLACEHOLDER_IMAGE, alt: sp.title, width: 800, height: 800 }],
    attributes: {},
    variantAxes: [],
    variants: [{ id: `${sp.id}-v1`, sku: `SP-${sp.id.toUpperCase()}`, options: {}, price: { amount: sp.price, currency: 'INR' }, ...(sp.mrp && sp.mrp > sp.price ? { mrp: { amount: sp.mrp, currency: 'INR' } } : {}), stock: sp.stock }],
    rating: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
    tags: [],
    createdAt: sp.createdAt,
    popularity: 10,
    sellerId: sp.sellerId,
  };
}

/** Device-local marketplace data (mock only). Registers itself as the catalog extension so approved listings reach the shop. */
@Injectable({ providedIn: 'root' })
export class MockSellerStore {
  private readonly storage = inject(STORAGE);

  constructor() {
    registerCatalogExtension((products, categories) => this.decorate(products, categories));
  }

  private read(): SellerState {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { sellers: null, products: null, shipments: [], statements: [], rules: null, ...(JSON.parse(raw) as Partial<SellerState>) } : { sellers: null, products: null, shipments: [], statements: [], rules: null };
    } catch {
      return { sellers: null, products: null, shipments: [], statements: [], rules: null };
    }
  }

  private write(state: SellerState): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked.
    }
  }

  /** Reads, changes and saves in one step; nothing is saved when `change` throws. */
  transact<T>(change: (state: { sellers: Seller[]; products: SellerProduct[]; shipments: Shipment[]; statements: PayoutStatement[]; rules: CommissionRule[] }) => T, now = Date.now()): T {
    const raw = this.read();
    const state = { sellers: raw.sellers ?? seedSellers(now), products: raw.products ?? seedSellerProducts(now), shipments: raw.shipments, statements: raw.statements, rules: raw.rules ?? seedCommissionRules() };
    const result = change(state);
    this.write(state);
    return result;
  }

  sellers(now = Date.now()): Seller[] {
    return this.read().sellers ?? seedSellers(now);
  }

  seller(id: string): Seller | undefined {
    return this.sellers().find((s) => s.id === id);
  }

  sellerOfUser(userId: string): Seller | undefined {
    return this.sellers().find((s) => s.ownerUserId === userId);
  }

  products(now = Date.now()): SellerProduct[] {
    return this.read().products ?? seedSellerProducts(now);
  }

  shipments(): Shipment[] {
    return this.read().shipments;
  }

  statements(): PayoutStatement[] {
    return this.read().statements;
  }

  rules(): CommissionRule[] {
    return this.read().rules ?? seedCommissionRules();
  }

  /** Which seller owns a catalog product: a listing's own seller, or the demo ownership of an existing product. */
  ownerOf(productId: string): string | undefined {
    return this.products().find((p) => p.id === productId)?.sellerId ?? SEED_OWNERSHIP[productId];
  }

  /** Only approved listings from sellers in good standing are on sale (MP-06). */
  private live(): { listing: SellerProduct; sellerName: string }[] {
    const sellers = new Map(this.sellers().map((s) => [s.id, s]));
    return this.products()
      .filter((p) => p.status === 'approved' && sellers.get(p.sellerId)?.status === 'approved')
      .map((p) => ({ listing: p, sellerName: sellers.get(p.sellerId)?.displayName ?? '' }));
  }

  /** The catalog every shop and cart read sees: demo ownership applied, approved seller listings added. */
  decorate(products: Product[], categories: Category[]): Product[] {
    const sellers = new Map(this.sellers().map((s) => [s.id, s]));
    // A suspended seller's catalog products go off sale too (their stock is shown as zero).
    const owned = products.map((p) => {
      const owner = SEED_OWNERSHIP[p.id];
      if (!owner) return p;
      const suspended = sellers.get(owner)?.status === 'suspended';
      return { ...p, sellerId: owner, ...(suspended ? { variants: p.variants.map((v) => ({ ...v, stock: 0 })) } : {}) };
    });
    return [...owned, ...this.live().map(({ listing, sellerName }) => toCatalogProduct(listing, categories, sellerName))];
  }

  // ---------- shipments (MP-04) ----------

  /** Splits a placed order into one shipment per seller (and one for the store's own items). Orders with no seller items get none. */
  createShipments(order: Order, now = Date.now()): Shipment[] {
    const groups = new Map<string | null, { variantIds: string[]; productId: string }[]>();
    for (const line of order.lines) {
      const owner = this.ownerOf(line.productId) ?? null;
      groups.set(owner, [...(groups.get(owner) ?? []), { variantIds: [line.variantId], productId: line.productId }]);
    }
    if ([...groups.keys()].every((k) => k === null)) return [];
    const at = new Date(now).toISOString();
    const sellers = new Map(this.sellers().map((s) => [s.id, s]));
    const made: Shipment[] = [...groups].map(([sellerId, items], i) => ({
      id: `${order.id}-S${i + 1}`,
      orderId: order.id,
      sellerId,
      sellerName: sellerId ? (sellers.get(sellerId)?.displayName ?? 'Seller') : 'the store',
      variantIds: items.flatMap((x) => x.variantIds),
      status: 'confirmed',
      timeline: [{ status: 'confirmed', at }],
    }));
    this.transact((s) => {
      s.shipments = [...s.shipments.filter((x) => x.orderId !== order.id), ...made];
    });
    return made;
  }

  /** Cancelling an order cancels every shipment that has not been delivered. */
  cancelShipments(orderId: string): void {
    const at = new Date().toISOString();
    this.transact((s) => {
      for (const sh of s.shipments) if (sh.orderId === orderId && sh.status !== 'delivered' && sh.status !== 'cancelled') {
        sh.status = 'cancelled';
        sh.timeline = [...sh.timeline, { status: 'cancelled', at }];
      }
    });
  }

  /**
   * Shows an order as its shipments: the store's own shipment follows the automatic progress, sellers move theirs by hand,
   * and the order is as far along as its slowest live shipment. `progressed` must already have `withProgress` applied.
   */
  applyShipments(progressed: Order): Order {
    const mine = this.shipments().filter((s) => s.orderId === progressed.id);
    if (mine.length === 0 || progressed.status === 'cancelled' || progressed.status === 'pending_payment') return mine.length ? { ...progressed, shipments: mine } : progressed;
    const platformStatus: ShipmentStatus = (SHIPMENT_FLOW as string[]).includes(progressed.status) ? (progressed.status as ShipmentStatus) : 'confirmed';
    const platformTimeline = progressed.timeline.filter((t): t is typeof t & { status: ShipmentStatus; at: string } => (SHIPMENT_FLOW as string[]).includes(t.status) && !!t.at).map((t) => ({ status: t.status, at: t.at }));
    const shipments = mine.map((s) => (s.sellerId === null ? { ...s, status: platformStatus, timeline: platformTimeline } : s));
    const overall = orderStatusFromShipments(shipments.map((s) => s.status));
    const step = (status: ShipmentStatus) => {
      const times = shipments.filter((s) => s.status !== 'cancelled').map((s) => s.timeline.find((t) => t.status === status)?.at);
      return times.every(Boolean) ? [...(times as string[])].sort().pop() : undefined;
    };
    const base = progressed.timeline.filter((t) => !['packed', 'shipped', 'delivered'].includes(t.status));
    const labels: Record<string, string> = { packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered' };
    const progress = (['packed', 'shipped', 'delivered'] as const).map((status) => ({ status, label: labels[status], ...(SHIPMENT_FLOW.indexOf(status) <= SHIPMENT_FLOW.indexOf(overall) ? (() => { const at = step(status) ?? progressed.timeline.find((t) => t.status === status)?.at; return at ? { at } : {}; })() : {}) }));
    return { ...progressed, status: overall as OrderStatus, shipments, timeline: [...base, ...progress] };
  }
}
