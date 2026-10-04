import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { InventoryAlert, InventoryRow, InventorySettings, MovementKind, Product, StockAdjustInput, StockLocation, StockMovement, StockTransferInput, Variant, VariantPolicy } from '@ecom/contracts';
import { ApiException, STOCK_REASONS } from '@ecom/contracts';

const KEY = 'ecom.mock.inventory.v1';
const MINUTE = 60_000;

export const MAIN_LOCATION = 'loc-main';
/** Seeded warehouses. Catalog stock starts in the main warehouse; orders draw from the lowest priority number first. */
export const LOCATIONS: readonly StockLocation[] = [
  { id: MAIN_LOCATION, name: 'Main warehouse', priority: 1 },
  { id: 'loc-blr', name: 'Bengaluru hub', priority: 2 },
];
export const DEFAULT_SETTINGS: InventorySettings = { reservationMinutes: 15, lowStockThreshold: 5 };

export interface StockLine {
  variantId: string;
  quantity: number;
}

interface Reservation {
  orderId: string;
  lines: StockLine[];
  expiresAt: number;
}

interface InventoryState {
  ledger: StockMovement[];
  reservations: Reservation[];
  policies: Record<string, VariantPolicy>;
  settings: InventorySettings;
  /** Active low-stock alerts, one per variant until it is replenished. */
  alerts: InventoryAlert[];
}

const emptyState = (): InventoryState => ({ ledger: [], reservations: [], policies: {}, settings: { ...DEFAULT_SETTINGS }, alerts: [] });

interface VariantEntry {
  product: Product;
  variant: Variant;
}

const indexVariants = (products: Product[]): Map<string, VariantEntry> => {
  const map = new Map<string, VariantEntry>();
  for (const product of products) for (const variant of product.variants) map.set(variant.id, { product, variant });
  return map;
};

const sum = (values: Record<string, number>): number => Object.values(values).reduce((a, b) => a + b, 0);
const nowIso = (now: number) => new Date(now).toISOString();
let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Ledger sums and units held by live reservations, computed once per operation. */
function summarise(state: InventoryState, now: number) {
  const delta = new Map<string, Record<string, number>>();
  for (const m of state.ledger) {
    const per = delta.get(m.variantId) ?? {};
    per[m.locationId] = (per[m.locationId] ?? 0) + m.quantity;
    delta.set(m.variantId, per);
  }
  const reserved = new Map<string, number>();
  for (const r of state.reservations) {
    if (r.expiresAt <= now) continue;
    for (const l of r.lines) reserved.set(l.variantId, (reserved.get(l.variantId) ?? 0) + l.quantity);
  }
  return { delta, reserved };
}

/** Units per location: the catalog baseline sits in the main warehouse, every other change comes from the ledger. */
function locationStock(baseline: number, delta: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const loc of LOCATIONS) out[loc.id] = (loc.id === MAIN_LOCATION ? baseline : 0) + (delta?.[loc.id] ?? 0);
  return out;
}

const isPristine = (s: InventoryState) => s.ledger.length === 0 && s.reservations.length === 0 && !Object.values(s.policies).some((p) => p.backorder);

/** Splits a sale across locations: the first location that can fulfil the whole line, else drain in priority order. */
function allocate(stock: Record<string, number>, quantity: number): { allocations: { locationId: string; quantity: number }[]; shortfall: number } {
  const ordered = [...LOCATIONS].sort((a, b) => a.priority - b.priority);
  const single = ordered.find((l) => stock[l.id] >= quantity);
  if (single) return { allocations: [{ locationId: single.id, quantity }], shortfall: 0 };
  const allocations: { locationId: string; quantity: number }[] = [];
  let left = quantity;
  for (const l of ordered) {
    const take = Math.min(Math.max(stock[l.id], 0), left);
    if (take > 0) {
      allocations.push({ locationId: l.id, quantity: take });
      left -= take;
    }
  }
  return { allocations, shortfall: left };
}

/**
 * Device-local stock ledger, reservations, thresholds and alerts for the mock adapters.
 * The shop and the admin both read it; a real backend keeps this in PostgreSQL behind row locks.
 * Every mutation reads, changes and writes in one synchronous step, so it is atomic in this single-threaded mock.
 */
@Injectable({ providedIn: 'root' })
export class MockInventoryStore {
  private readonly storage = inject(STORAGE);

  // ---------- reads ----------

  private read(): InventoryState {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { ...emptyState(), ...(JSON.parse(raw) as Partial<InventoryState>) } : emptyState();
    } catch {
      return emptyState();
    }
  }

  private write(state: InventoryState): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked; the change stays in memory for this call only.
    }
  }

  /** Reads, changes and saves in one step; nothing is saved when `change` throws. */
  private transact<T>(change: (state: InventoryState) => T): T {
    const state = this.read();
    const result = change(state);
    this.write(state);
    return result;
  }

  settings(): InventorySettings {
    return { ...this.read().settings };
  }

  locations(): StockLocation[] {
    return LOCATIONS.map((l) => ({ ...l }));
  }

  /** Newest first. */
  movements(): StockMovement[] {
    return [...this.read().ledger].reverse();
  }

  alerts(): InventoryAlert[] {
    return this.read().alerts;
  }

  policies(): Record<string, VariantPolicy> {
    return this.read().policies;
  }

  /**
   * Catalog products with live stock applied. `available` (shop) is on hand minus units held for unpaid orders;
   * `onHand` (admin) is the physical count. Returns the input untouched when nothing has moved yet.
   */
  apply(products: Product[], mode: 'available' | 'onHand' = 'available', now = Date.now()): Product[] {
    const state = this.read();
    if (isPristine(state)) return products;
    const { delta, reserved } = summarise(state, now);
    return products.map((p) => {
      let changed = false;
      const variants = p.variants.map((v) => {
        const d = delta.get(v.id);
        const policy = state.policies[v.id];
        const held = mode === 'available' ? reserved.get(v.id) : undefined;
        if (!d && !policy?.backorder && !held) return v;
        changed = true;
        const onHand = sum(locationStock(v.stock, d));
        const stock = mode === 'available' ? Math.max(0, onHand - (held ?? 0)) : onHand;
        const next: Variant = { ...v, stock };
        if (policy?.backorder) next.backorder = policy.expectedDate ? { expectedDate: policy.expectedDate } : {};
        return next;
      });
      return changed ? { ...p, variants } : p;
    });
  }

  /** One row per variant for the admin stock screen. */
  rows(products: Product[], now = Date.now()): InventoryRow[] {
    const state = this.read();
    const { delta, reserved } = summarise(state, now);
    return products.flatMap((p) =>
      p.variants.map((v): InventoryRow => {
        const byLocation = locationStock(v.stock, delta.get(v.id));
        const onHand = sum(byLocation);
        const held = reserved.get(v.id) ?? 0;
        const available = onHand - held;
        const policy = state.policies[v.id];
        const threshold = policy?.threshold ?? state.settings.lowStockThreshold;
        return {
          variantId: v.id,
          productId: p.id,
          sku: v.sku,
          title: p.title,
          options: v.options,
          onHand,
          reserved: held,
          available,
          byLocation,
          threshold,
          customThreshold: policy?.threshold !== undefined,
          low: available <= threshold,
          backorder: !!policy?.backorder,
          ...(policy?.expectedDate ? { expectedDate: policy.expectedDate } : {}),
        };
      }),
    );
  }

  // ---------- shop side: reservations, sales, cancellations ----------

  /** Holds stock for an unpaid order. Refuses when the units are no longer available. */
  reserve(orderId: string, lines: StockLine[], products: Product[], now = Date.now()): void {
    this.transact((s) => {
      const index = indexVariants(products);
      const { delta, reserved } = summarise(s, now);
      const own = s.reservations.find((r) => r.orderId === orderId);
      const wanted = this.aggregate(lines);
      for (const [variantId, quantity] of wanted) {
        const entry = this.entryOrThrow(index, variantId);
        const held = (reserved.get(variantId) ?? 0) - (own && own.expiresAt > now ? own.lines.filter((l) => l.variantId === variantId).reduce((a, l) => a + l.quantity, 0) : 0);
        const available = sum(locationStock(entry.variant.stock, delta.get(variantId))) - held;
        if (!s.policies[variantId]?.backorder && available < quantity) throw this.soldOut(entry, available);
      }
      s.reservations = [...s.reservations.filter((r) => r.orderId !== orderId), { orderId, lines: [...wanted].map(([variantId, quantity]) => ({ variantId, quantity })), expiresAt: now + s.settings.reservationMinutes * MINUTE }];
      this.evaluate(s, index, [...wanted.keys()], now);
    });
  }

  /** Turns a sale into ledger entries (and drops the order's reservation). Safe to call twice for the same order. */
  sell(orderId: string, lines: StockLine[], products: Product[], actor = 'Checkout', now = Date.now()): void {
    this.transact((s) => {
      if (s.ledger.some((m) => m.orderId === orderId && m.kind === 'sale')) return;
      const index = indexVariants(products);
      const { delta, reserved } = summarise(s, now);
      const own = s.reservations.find((r) => r.orderId === orderId);
      const wanted = this.aggregate(lines);
      for (const [variantId, quantity] of wanted) {
        const entry = this.entryOrThrow(index, variantId);
        const ownHeld = own && own.expiresAt > now ? own.lines.filter((l) => l.variantId === variantId).reduce((a, l) => a + l.quantity, 0) : 0;
        const available = sum(locationStock(entry.variant.stock, delta.get(variantId))) - ((reserved.get(variantId) ?? 0) - ownHeld);
        if (!s.policies[variantId]?.backorder && available < quantity) throw this.soldOut(entry, available);
      }
      s.reservations = s.reservations.filter((r) => r.orderId !== orderId);
      for (const [variantId, quantity] of wanted) {
        const entry = this.entryOrThrow(index, variantId);
        const stock = locationStock(entry.variant.stock, summarise(s, now).delta.get(variantId));
        const { allocations, shortfall } = allocate(stock, quantity);
        if (shortfall > 0) allocations.push({ locationId: MAIN_LOCATION, quantity: shortfall });
        for (const a of allocations) s.ledger.push(this.movement(entry, a.locationId, 'sale', -a.quantity, 'order_placed', actor, now, { orderId }));
      }
      this.evaluate(s, index, [...wanted.keys()], now);
    });
  }

  /** Frees the units held for an order (payment failed or the customer cancelled before paying). */
  release(orderId: string, products: Product[], now = Date.now()): void {
    this.transact((s) => {
      const held = s.reservations.find((r) => r.orderId === orderId);
      if (!held) return;
      s.reservations = s.reservations.filter((r) => r.orderId !== orderId);
      this.evaluate(s, indexVariants(products), held.lines.map((l) => l.variantId), now);
    });
  }

  /** Removes reservations past their time and returns the order ids that lost their hold. */
  expire(products: Product[], now = Date.now()): string[] {
    const current = this.read();
    if (!current.reservations.some((r) => r.expiresAt <= now)) return [];
    return this.transact((s) => {
      const gone = s.reservations.filter((r) => r.expiresAt <= now);
      s.reservations = s.reservations.filter((r) => r.expiresAt > now);
      this.evaluate(s, indexVariants(products), gone.flatMap((r) => r.lines.map((l) => l.variantId)), now);
      return gone.map((r) => r.orderId);
    });
  }

  /**
   * Puts an order's units back after a cancellation. Uses the order's own sale entries; for orders that never went
   * through this ledger (seeded demo orders) `fallback` lines are restored to the main warehouse instead.
   */
  restore(orderId: string, products: Product[], fallback?: StockLine[], actor = 'Cancellation', now = Date.now()): void {
    this.transact((s) => {
      s.reservations = s.reservations.filter((r) => r.orderId !== orderId);
      const index = indexVariants(products);
      const touched = new Set<string>();
      const mine = s.ledger.filter((m) => m.orderId === orderId && (m.kind === 'sale' || m.kind === 'cancellation'));
      if (mine.length > 0) {
        const net = new Map<string, number>();
        for (const m of mine) net.set(`${m.variantId}|${m.locationId}`, (net.get(`${m.variantId}|${m.locationId}`) ?? 0) - m.quantity);
        for (const [key, sold] of net) {
          if (sold <= 0) continue;
          const [variantId, locationId] = key.split('|');
          const entry = index.get(variantId);
          if (!entry) continue;
          s.ledger.push(this.movement(entry, locationId, 'cancellation', sold, 'order_cancelled', actor, now, { orderId }));
          touched.add(variantId);
        }
      } else if (fallback) {
        for (const line of this.aggregate(fallback)) {
          const entry = index.get(line[0]);
          if (!entry) continue;
          s.ledger.push(this.movement(entry, MAIN_LOCATION, 'cancellation', line[1], 'order_cancelled', actor, now, { orderId }));
          touched.add(line[0]);
        }
      }
      this.evaluate(s, index, [...touched], now);
    });
  }

  // ---------- admin side ----------

  /** Records opening stock for a newly created variant. */
  receiveOpening(variantId: string, quantity: number, products: Product[], actor: string, now = Date.now()): void {
    if (quantity <= 0) return;
    this.transact((s) => {
      const index = indexVariants(products);
      s.ledger.push(this.movement(this.entryOrThrow(index, variantId), MAIN_LOCATION, 'receive', quantity, 'received_shipment', actor, now, { note: 'Opening stock' }));
      this.evaluate(s, index, [variantId], now);
    });
  }

  adjust(input: StockAdjustInput, products: Product[], actor: string, now = Date.now()): void {
    this.transact((s) => {
      const index = indexVariants(products);
      const entry = index.get(input.variantId);
      const fields: Record<string, string> = {};
      if (!entry) throw new ApiException('not_found', 'Variant not found');
      if (!LOCATIONS.some((l) => l.id === input.locationId)) fields['locationId'] = 'Choose a location';
      const reason = STOCK_REASONS.find((r) => r.code === input.reason);
      if (!input.reason) fields['reason'] = 'Choose a reason';
      else if (!reason || !reason.kinds.includes(input.kind)) fields['reason'] = 'This reason does not fit that kind of change';
      if (!Number.isInteger(input.quantity) || input.quantity === 0) fields['quantity'] = 'Enter a whole number of units';
      else if (input.kind !== 'correction' && input.quantity < 0) fields['quantity'] = 'Enter a positive number of units';
      if (input.reason === 'other' && !input.note?.trim()) fields['note'] = 'Explain the change in the note';
      if ((input.note?.length ?? 0) > 200) fields['note'] = 'Notes are limited to 200 characters';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);

      const change = input.kind === 'damage' ? -Math.abs(input.quantity) : input.quantity;
      const { delta } = summarise(s, now);
      const current = locationStock(entry.variant.stock, delta.get(input.variantId))[input.locationId];
      if (change < 0 && current + change < 0 && !s.policies[input.variantId]?.backorder) {
        throw new ApiException('validation', `Only ${Math.max(current, 0)} unit(s) at that location, so stock cannot go below zero.`, { quantity: `Only ${Math.max(current, 0)} at this location` });
      }
      s.ledger.push(this.movement(entry, input.locationId, input.kind, change, input.reason, actor, now, input.note?.trim() ? { note: input.note.trim() } : {}));
      this.evaluate(s, index, [input.variantId], now);
    });
  }

  /** Moves units between locations as a pair of ledger entries that share a transfer id. */
  transfer(input: StockTransferInput, products: Product[], actor: string, now = Date.now()): void {
    this.transact((s) => {
      const index = indexVariants(products);
      const entry = index.get(input.variantId);
      if (!entry) throw new ApiException('not_found', 'Variant not found');
      const fields: Record<string, string> = {};
      const valid = (id: string) => LOCATIONS.some((l) => l.id === id);
      if (!valid(input.fromLocationId)) fields['fromLocationId'] = 'Choose a location';
      if (!valid(input.toLocationId)) fields['toLocationId'] = 'Choose a location';
      if (input.fromLocationId === input.toLocationId) fields['toLocationId'] = 'Choose a different location';
      if (!Number.isInteger(input.quantity) || input.quantity <= 0) fields['quantity'] = 'Enter a positive whole number';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const { delta } = summarise(s, now);
      const have = locationStock(entry.variant.stock, delta.get(input.variantId))[input.fromLocationId];
      if (have < input.quantity) throw new ApiException('validation', `Only ${Math.max(have, 0)} unit(s) at the source location.`, { quantity: `Only ${Math.max(have, 0)} at the source` });
      const transferId = newId('trf');
      const extra = { transferId, ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
      s.ledger.push(this.movement(entry, input.fromLocationId, 'transfer', -input.quantity, 'transfer', actor, now, extra));
      s.ledger.push(this.movement(entry, input.toLocationId, 'transfer', input.quantity, 'transfer', actor, now, extra));
    });
  }

  setPolicy(variantId: string, policy: VariantPolicy, products: Product[], now = Date.now()): void {
    this.transact((s) => {
      const index = indexVariants(products);
      if (!index.has(variantId)) throw new ApiException('not_found', 'Variant not found');
      const fields: Record<string, string> = {};
      if (policy.threshold !== undefined && (!Number.isInteger(policy.threshold) || policy.threshold < 0 || policy.threshold > 10_000)) fields['threshold'] = 'Use a whole number from 0 to 10,000';
      if (policy.expectedDate && Number.isNaN(new Date(policy.expectedDate).getTime())) fields['expectedDate'] = 'Enter a valid date';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      s.policies[variantId] = { backorder: policy.backorder, ...(policy.threshold !== undefined ? { threshold: policy.threshold } : {}), ...(policy.backorder && policy.expectedDate ? { expectedDate: policy.expectedDate } : {}) };
      this.evaluate(s, index, [variantId], now);
    });
  }

  saveSettings(settings: InventorySettings, products: Product[], now = Date.now()): void {
    this.transact((s) => {
      const fields: Record<string, string> = {};
      if (!Number.isInteger(settings.reservationMinutes) || settings.reservationMinutes < 1 || settings.reservationMinutes > 1440) fields['reservationMinutes'] = 'Use a whole number from 1 to 1,440 minutes';
      if (!Number.isInteger(settings.lowStockThreshold) || settings.lowStockThreshold < 0 || settings.lowStockThreshold > 1000) fields['lowStockThreshold'] = 'Use a whole number from 0 to 1,000';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      s.settings = { ...settings };
      const index = indexVariants(products);
      this.evaluate(s, index, [...index.keys()], now);
    });
  }

  /** Sets stock at a location to target levels. All rows apply together in one save. Returns how many rows changed stock. */
  applyLevels(rows: { variantId: string; locationId: string; target: number }[], products: Product[], actor: string, now = Date.now()): number {
    return this.transact((s) => {
      const index = indexVariants(products);
      let changed = 0;
      const touched = new Set<string>();
      for (const row of rows) {
        const entry = this.entryOrThrow(index, row.variantId);
        const { delta } = summarise(s, now);
        const current = locationStock(entry.variant.stock, delta.get(row.variantId))[row.locationId];
        const diff = row.target - current;
        if (diff === 0) continue;
        s.ledger.push(this.movement(entry, row.locationId, 'correction', diff, 'count_correction', actor, now, { note: 'Bulk import' }));
        touched.add(row.variantId);
        changed += 1;
      }
      this.evaluate(s, index, [...touched], now);
      return changed;
    });
  }

  // ---------- internals ----------

  private aggregate(lines: StockLine[]): Map<string, number> {
    const wanted = new Map<string, number>();
    for (const l of lines) wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0) + l.quantity);
    return wanted;
  }

  private entryOrThrow(index: Map<string, VariantEntry>, variantId: string): VariantEntry {
    const entry = index.get(variantId);
    if (!entry) throw new ApiException('not_found', 'This product is no longer available.');
    return entry;
  }

  private soldOut(entry: VariantEntry, available: number): ApiException {
    const title = entry.product.title;
    return new ApiException('validation', available > 0 ? `Sorry, only ${available} of ${title} left. Please update your cart.` : `Sorry, ${title} just sold out. Please update your cart.`);
  }

  private movement(entry: VariantEntry, locationId: string, kind: MovementKind, quantity: number, reason: string, actor: string, now: number, extra: Partial<StockMovement> = {}): StockMovement {
    return { id: newId('mv'), at: nowIso(now), variantId: entry.variant.id, sku: entry.variant.sku, productId: entry.product.id, title: entry.product.title, locationId, kind, quantity, reason, actor, ...extra };
  }

  /** Raises one alert when a variant drops to its threshold and clears it once stock is back above. */
  private evaluate(s: InventoryState, index: Map<string, VariantEntry>, variantIds: string[], now: number): void {
    const { delta, reserved } = summarise(s, now);
    for (const id of new Set(variantIds)) {
      const entry = index.get(id);
      if (!entry) continue;
      const available = sum(locationStock(entry.variant.stock, delta.get(id))) - (reserved.get(id) ?? 0);
      const threshold = s.policies[id]?.threshold ?? s.settings.lowStockThreshold;
      const existing = s.alerts.find((a) => a.variantId === id);
      if (available <= threshold) {
        if (existing) existing.available = available;
        else s.alerts = [{ variantId: id, sku: entry.variant.sku, title: entry.product.title, available, threshold, at: nowIso(now) }, ...s.alerts].slice(0, 100);
      } else if (existing) {
        s.alerts = s.alerts.filter((a) => a.variantId !== id);
      }
    }
  }
}
