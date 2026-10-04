import { Injectable, inject } from '@shop/core';
import type {
  AdminCategoryOption,
  AdminCoupon,
  AdminOrderDetail,
  AdminOrderQuery,
  AdminOrderRow,
  AdminProductDetail,
  AdminProductInput,
  AdminProductQuery,
  AdminProductRow,
  AdminReviewRow,
  AdminUser,
  AuditEntry,
  DashboardMetrics,
  Order,
  OrderStatus,
  Paged,
  Product,
  ProductStatus,
  Role,
  Variant,
} from '@ecom/contracts';
import { ApiException, ORDER_TRANSITIONS } from '@ecom/contracts';

export { ORDER_TRANSITIONS };
import { AdminCouponApi, AdminDashboardApi, AdminOrderApi, AdminProductApi, AdminReviewApi, AdminUserApi, AuditApi } from '../../lib/admin.api';
import { COUPONS } from '../cart-engine';
import { loadCatalogData } from '../catalog-data';
import { createMockResponder } from '../mock-latency';
import { MockNotificationStore } from '../notification-store';
import { MockOrderStore } from '../mock-order-store';
import { MockPromotionStore } from '../promotion-store';
import { MockSellerStore } from '../seller-store';
import { MockUserStore } from '../mock-user-store';
import { type AdminOverlay, MockAdminState } from './admin-state';
import { SEED_CUSTOMERS, seedOrders } from './seed-orders';

const DAY = 86_400_000;
const nowIso = () => new Date().toISOString();
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inr = (amount: number) => ({ amount: Math.round(amount), currency: 'INR' as const });

// ORDER_TRANSITIONS now lives in @ecom/contracts (order-derive.ts) so apps/api can use it too — the
// same pattern as catalog-engine.ts/cart-engine.ts's relocation. Re-exported below for existing imports.

const STATUS_LABEL: Record<string, string> = { packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Order cancelled' };

// ---------- shared data helpers ----------

export interface AdminProduct {
  /** With physical stock (on hand) from the ledger applied. */
  product: Product;
  /** As stored: variant stock is the opening baseline, before any ledger movement. */
  baseline: Product;
  status: ProductStatus;
  updatedAt: string;
}

/** Seeded catalog with the admin's edits, creations and deletions applied, and live stock counts from the ledger. */
export async function loadProducts(state: MockAdminState): Promise<AdminProduct[]> {
  const { products } = await loadCatalogData();
  const o = state.read();
  const deleted = new Set(o.deletedProducts);
  const all = [...products.filter((p) => !deleted.has(p.id)).map((p) => o.editedProducts[p.id] ?? p), ...o.createdProducts];
  const stocked = state.inventory.apply(all, 'onHand');
  return all.map((baseline, i) => ({ product: stocked[i], baseline, status: o.productMeta[baseline.id]?.status ?? 'published', updatedAt: o.productMeta[baseline.id]?.updatedAt ?? baseline.createdAt }));
}

/** Seeded demo orders with the admin's status changes and notes applied. */
async function loadOrders(state: MockAdminState): Promise<{ order: Order; notes: AdminOrderDetail['notes'] }[]> {
  const { products } = await loadCatalogData();
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const o = state.read();
  return seedOrders(products, today.getTime()).map((order) => {
    const ov = o.orders[order.id];
    return { order: ov ? { ...order, status: ov.status ?? order.status, timeline: ov.timeline ?? order.timeline } : order, notes: ov?.notes ?? [] };
  });
}

const toDetail = (order: Order, notes: AdminOrderDetail['notes']): AdminOrderDetail => ({ ...order, notes, allowedNext: ORDER_TRANSITIONS[order.status] });

// ---------- products ----------

function validateProduct(input: AdminProductInput, categoryIds: Set<string>, others: Variant[]): void {
  const fields: Record<string, string> = {};
  if (!input.title.trim()) fields['title'] = 'Title is required';
  else if (input.title.length > 120) fields['title'] = 'Title is too long (120 characters at most)';
  if (!input.brandName.trim()) fields['brandName'] = 'Brand is required';
  if (!categoryIds.has(input.categoryId)) fields['categoryId'] = 'Choose a category';
  if (input.description.length > 2000) fields['description'] = 'Description is too long (2,000 characters at most)';
  if (input.variants.length === 0) fields['variants'] = 'Add at least one variant';
  const skus = new Set<string>();
  input.variants.forEach((v, i) => {
    if (!v.sku.trim()) fields[`variants.${i}.sku`] = 'SKU is required';
    else if (skus.has(v.sku.trim()) || others.some((o) => o.sku === v.sku.trim() && o.id !== v.id)) fields[`variants.${i}.sku`] = 'SKU must be unique';
    skus.add(v.sku.trim());
    if (!(v.price > 0)) fields[`variants.${i}.price`] = 'Price must be greater than zero';
    if (v.mrp !== undefined && v.mrp < v.price) fields[`variants.${i}.mrp`] = 'MRP cannot be lower than the price';
    if (!Number.isInteger(v.stock) || v.stock < 0) fields[`variants.${i}.stock`] = 'Stock must be a whole number, 0 or more';
  });
  if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildVariants(productId: string, input: AdminProductInput, existing: Variant[]): Variant[] {
  return input.variants.map((v, i) => {
    const previous = existing.find((e) => e.id === v.id);
    return {
      id: previous?.id ?? `${productId}-v${Date.now().toString(36)}${i}`,
      sku: v.sku.trim(),
      options: v.options,
      price: inr(v.price),
      ...(v.mrp && v.mrp > v.price ? { mrp: inr(v.mrp) } : {}),
      // Stock is managed through the inventory ledger: existing variants keep their baseline, new ones start at 0
      // and get an opening "receive" movement for the quantity typed in the form.
      stock: previous ? previous.stock : 0,
      ...(previous?.images ? { images: previous.images } : {}),
    };
  });
}

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

const plainText = (html: string) => html.replace(/<\/p>\s*<p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function toDetailProduct(entry: AdminProduct, categoryName: string): AdminProductDetail {
  const p = entry.product;
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    brandName: p.brandName,
    categoryId: p.categoryId,
    categoryName,
    description: plainText(p.description),
    highlights: p.highlights,
    tags: p.tags,
    status: entry.status,
    variantAxes: p.variantAxes,
    updatedAt: entry.updatedAt,
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, price: v.price.amount, ...(v.mrp ? { mrp: v.mrp.amount } : {}), stock: v.stock })),
  };
}

@Injectable()
export class MockAdminProductApi extends AdminProductApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly notifications = inject(MockNotificationStore);

  list(query: AdminProductQuery) {
    return this.respond.okAsync<Paged<AdminProductRow>>(async () => {
      this.state.require('product:read');
      const q = query.q?.trim().toLowerCase();
      let rows = (await loadProducts(this.state)).filter((e) => (!query.status || e.status === query.status) && (!q || `${e.product.title} ${e.product.brandName} ${e.product.variants.map((v) => v.sku).join(' ')}`.toLowerCase().includes(q)));
      const price = (e: AdminProduct) => Math.min(...e.product.variants.map((v) => v.price.amount));
      const stock = (e: AdminProduct) => e.product.variants.reduce((s, v) => s + v.stock, 0);
      const cmp: Record<AdminProductQuery['sort'], (a: AdminProduct, b: AdminProduct) => number> = {
        updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        title: (a, b) => a.product.title.localeCompare(b.product.title),
        price: (a, b) => price(a) - price(b),
        stock: (a, b) => stock(a) - stock(b),
      };
      rows = [...rows].sort((a, b) => (cmp[query.sort](a, b) || a.product.id.localeCompare(b.product.id)) * (query.dir === 'asc' ? 1 : -1));
      const pageSize = Math.max(1, query.pageSize);
      const page = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
      return {
        total: rows.length,
        page,
        pageSize,
        items: rows.slice((page - 1) * pageSize, page * pageSize).map((e) => ({
          id: e.product.id,
          slug: e.product.slug,
          title: e.product.title,
          brandName: e.product.brandName,
          categoryName: e.product.categoryPath[e.product.categoryPath.length - 1].name,
          status: e.status,
          priceMin: inr(price(e)),
          stockTotal: stock(e),
          variantCount: e.product.variants.length,
          image: e.product.images[0],
          updatedAt: e.updatedAt,
        })),
      };
    });
  }

  categories() {
    return this.respond.okAsync<AdminCategoryOption[]>(async () => {
      this.state.require('product:read');
      return (await loadCatalogData()).categories.filter((c) => c.parentId).map((c) => ({ id: c.id, name: c.name }));
    });
  }

  get(id: string) {
    return this.respond.okAsync<AdminProductDetail>(async () => {
      this.state.require('product:read');
      const entry = (await loadProducts(this.state)).find((e) => e.product.id === id);
      if (!entry) throw new ApiException('not_found', 'Product not found');
      return toDetailProduct(entry, entry.product.categoryPath[entry.product.categoryPath.length - 1].name);
    });
  }

  create(input: AdminProductInput) {
    return this.respond.okAsync<AdminProductDetail>(async () => {
      this.state.require('product:write');
      const { categories } = await loadCatalogData();
      const all = await loadProducts(this.state);
      validateProduct(input, new Set(categories.filter((c) => c.parentId).map((c) => c.id)), all.flatMap((e) => e.product.variants));
      const leaf = categories.find((c) => c.id === input.categoryId);
      const parent = categories.find((c) => c.id === leaf?.parentId);
      if (!leaf || !parent) throw new ApiException('validation', 'Choose a category', { categoryId: 'Choose a category' });
      const donor = all.find((e) => e.product.categoryId === leaf.id)?.product ?? all[0].product;
      const id = `p-new-${Date.now().toString(36)}`;
      const created: Product = {
        id,
        slug: `${slugify(input.title)}-${id.slice(-4)}`,
        title: input.title.trim(),
        brandId: `brand-${slugify(input.brandName)}`,
        brandName: input.brandName.trim(),
        categoryId: leaf.id,
        categoryPath: [
          { id: parent.id, slug: parent.slug, name: parent.name },
          { id: leaf.id, slug: leaf.slug, name: leaf.name },
        ],
        description: paragraphs(input.description),
        highlights: input.highlights,
        images: donor.images,
        attributes: {},
        variantAxes: Object.keys(input.variants[0].options),
        variants: buildVariants(id, input, []),
        rating: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0] },
        tags: input.tags,
        createdAt: nowIso(),
        popularity: 0,
      };
      this.state.update((o) => {
        o.createdProducts.push(created);
        o.productMeta[id] = { status: input.status, updatedAt: nowIso() };
      });
      const actor = this.state.require('product:write');
      created.variants.forEach((v, i) => this.state.inventory.receiveOpening(v.id, input.variants[i].stock, [created], actor.name));
      this.state.record('product.create', created.title, `Created as ${input.status}`);
      const entry = (await loadProducts(this.state)).find((e) => e.product.id === id) as AdminProduct;
      return toDetailProduct(entry, leaf.name);
    });
  }

  update(id: string, input: AdminProductInput) {
    return this.respond.okAsync<AdminProductDetail>(async () => {
      this.state.require('product:write');
      const { categories } = await loadCatalogData();
      const all = await loadProducts(this.state);
      const entry = all.find((e) => e.product.id === id);
      if (!entry) throw new ApiException('not_found', 'Product not found');
      validateProduct(input, new Set(categories.filter((c) => c.parentId).map((c) => c.id)), all.filter((e) => e.product.id !== id).flatMap((e) => e.product.variants));
      const old = entry.baseline;
      const updated: Product = {
        ...old,
        title: input.title.trim(),
        brandName: input.brandName.trim(),
        description: paragraphs(input.description),
        highlights: input.highlights,
        tags: input.tags,
        variants: buildVariants(old.id, input, old.variants),
      };
      const changes: string[] = [];
      if (old.title !== updated.title) changes.push('title');
      if (JSON.stringify(old.variants.map((v) => v.price.amount)) !== JSON.stringify(updated.variants.map((v) => v.price.amount))) changes.push('price');
      const addedVariants = updated.variants.filter((v) => !old.variants.some((e) => e.id === v.id));
      if (addedVariants.length) changes.push(`${addedVariants.length} new variant(s)`);
      if (entry.status !== input.status) changes.push(`status ${entry.status} to ${input.status}`);
      this.state.update((o) => {
        const isCreated = o.createdProducts.findIndex((p) => p.id === id);
        if (isCreated >= 0) o.createdProducts[isCreated] = updated;
        else o.editedProducts[id] = updated;
        o.productMeta[id] = { status: input.status, updatedAt: nowIso() };
      });
      const actor = this.state.require('product:write');
      // Variants keep the order of the form, so the typed quantity of a new variant sits at the same index.
      updated.variants.forEach((v, i) => {
        if (addedVariants.includes(v)) this.state.inventory.receiveOpening(v.id, input.variants[i].stock, [updated], actor.name);
      });
      this.state.record('product.update', updated.title, changes.length ? `Changed ${changes.join(', ')}` : 'Saved without changes');
      // The shop reads a separate, unlinked copy of the catalog in this mock, so a price cut is checked against
      // subscribers here, at the moment it happens, rather than waiting for a shop-side catalog read to notice it.
      if (changes.includes('price')) this.notifications.checkAlerts(this.state.inventory.apply([updated]));
      const fresh = (await loadProducts(this.state)).find((e) => e.product.id === id) as AdminProduct;
      return toDetailProduct(fresh, fresh.product.categoryPath[fresh.product.categoryPath.length - 1].name);
    });
  }

  bulkSetStatus(ids: string[], status: ProductStatus) {
    return this.respond.okAsync<number>(async () => {
      this.state.require('product:write');
      const known = new Set((await loadProducts(this.state)).map((e) => e.product.id));
      const targets = ids.filter((id) => known.has(id));
      this.state.update((o) => {
        for (const id of targets) o.productMeta[id] = { status, updatedAt: nowIso() };
      });
      if (targets.length) this.state.record('product.bulk_status', `${targets.length} products`, `Set to ${status}`);
      return targets.length;
    });
  }

  bulkDeleteDrafts(ids: string[]) {
    return this.respond.okAsync<number>(async () => {
      this.state.require('product:write');
      const drafts = (await loadProducts(this.state)).filter((e) => ids.includes(e.product.id) && e.status === 'draft').map((e) => e.product.id);
      this.state.update((o: AdminOverlay) => {
        o.createdProducts = o.createdProducts.filter((p) => !drafts.includes(p.id));
        o.deletedProducts = [...new Set([...o.deletedProducts, ...drafts])];
        for (const id of drafts) {
          delete o.editedProducts[id];
          delete o.productMeta[id];
        }
      });
      if (drafts.length) this.state.record('product.delete', `${drafts.length} draft products`, 'Deleted');
      return drafts.length;
    });
  }
}

// ---------- orders ----------

const TEMPLATE_FOR_STATUS: Partial<Record<OrderStatus, string>> = { packed: 'order_packed', shipped: 'order_shipped', delivered: 'order_delivered', cancelled: 'order_cancelled' };

@Injectable()
export class MockAdminOrderApi extends AdminOrderApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly notifications = inject(MockNotificationStore);
  private readonly wallet = inject(MockPromotionStore);
  private readonly orderStore = inject(MockOrderStore);
  private readonly sellerStore = inject(MockSellerStore);

  list(query: AdminOrderQuery) {
    return this.respond.okAsync<Paged<AdminOrderRow>>(async () => {
      this.state.require('order:read:any');
      const q = query.q?.trim().toLowerCase();
      const from = query.from ? new Date(`${query.from}T00:00:00Z`).getTime() : undefined;
      const to = query.to ? new Date(`${query.to}T23:59:59Z`).getTime() : undefined;
      const rows = (await loadOrders(this.state)).filter(({ order: o }) => {
        const t = new Date(o.createdAt).getTime();
        return (!query.status || o.status === query.status) && (!query.paymentMethod || o.paymentMethod === query.paymentMethod) && (from === undefined || t >= from) && (to === undefined || t <= to) && (!q || o.id.toLowerCase().includes(q) || o.contact.name.toLowerCase().includes(q) || o.contact.email.toLowerCase().includes(q));
      });
      const pageSize = Math.max(1, query.pageSize);
      const page = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
      return {
        total: rows.length,
        page,
        pageSize,
        items: rows.slice((page - 1) * pageSize, page * pageSize).map(({ order: o }) => ({ id: o.id, createdAt: o.createdAt, customerName: o.contact.name, itemCount: o.totals.itemCount, total: o.totals.total, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod })),
      };
    });
  }

  get(id: string) {
    return this.respond.okAsync<AdminOrderDetail>(async () => {
      this.state.require('order:read:any');
      const found = (await loadOrders(this.state)).find((e) => e.order.id === id);
      if (!found) throw new ApiException('not_found', 'Order not found');
      return toDetail(found.order, found.notes);
    });
  }

  advance(id: string, status: OrderStatus) {
    return this.respond.okAsync<AdminOrderDetail>(async () => {
      this.state.require('order:refund');
      const found = (await loadOrders(this.state)).find((e) => e.order.id === id);
      if (!found) throw new ApiException('not_found', 'Order not found');
      const order = found.order;
      if (!ORDER_TRANSITIONS[order.status].includes(status)) throw new ApiException('validation', `An order that is ${order.status.replace('_', ' ')} cannot move to ${status}.`);
      const timeline = [...order.timeline.filter((t) => t.at), { status, label: STATUS_LABEL[status] ?? status, at: nowIso() }];
      if (status === 'cancelled') {
        // Cancelling gives the units back: unpaid orders only held a reservation, the rest had sold units.
        const baselines = (await loadProducts(this.state)).map((e) => e.baseline);
        if (order.status === 'pending_payment') this.state.inventory.release(id, baselines);
        else this.state.inventory.restore(id, baselines, order.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), this.state.require('order:refund').name);
        // A gift card or store credit that paid for the order goes back to where it came from.
        const stored = this.orderStore.find(id);
        if (stored?.tender) this.orderStore.save(this.wallet.refund(stored, this.state.require('order:refund').name));
        this.sellerStore.cancelShipments(id);
      }
      const template = TEMPLATE_FOR_STATUS[status];
      if (template) this.notifications.deliver(template, order.contact.email, { name: order.contact.name, orderId: order.id }, { userId: order.userId, link: `/orders/${order.id}` });
      this.state.update((o) => {
        o.orders[id] = { ...(o.orders[id] ?? { notes: [] }), status, timeline };
      });
      this.state.record('order.status', id, `${order.status} to ${status}`);
      const fresh = (await loadOrders(this.state)).find((e) => e.order.id === id) as { order: Order; notes: AdminOrderDetail['notes'] };
      return toDetail({ ...fresh.order, paymentStatus: status === 'cancelled' && order.paymentStatus === 'paid' ? 'refund_pending' : fresh.order.paymentStatus }, fresh.notes);
    });
  }

  addNote(id: string, text: string) {
    return this.respond.okAsync<AdminOrderDetail>(async () => {
      const actor = this.state.require('order:read:any');
      const clean = text.trim();
      if (!clean) throw new ApiException('validation', 'Write a note first.', { text: 'A note cannot be empty' });
      if (clean.length > 500) throw new ApiException('validation', 'Notes are limited to 500 characters.', { text: 'Too long' });
      const found = (await loadOrders(this.state)).find((e) => e.order.id === id);
      if (!found) throw new ApiException('not_found', 'Order not found');
      this.state.update((o) => {
        const ov = o.orders[id] ?? { notes: [] };
        ov.notes = [{ id: `note_${Date.now().toString(36)}`, at: nowIso(), author: actor.name, text: clean }, ...ov.notes];
        o.orders[id] = ov;
      });
      this.state.record('order.note', id, 'Added a note');
      const fresh = (await loadOrders(this.state)).find((e) => e.order.id === id) as { order: Order; notes: AdminOrderDetail['notes'] };
      return toDetail(fresh.order, fresh.notes);
    });
  }
}

// ---------- coupons ----------

const COUPON_KINDS = new Set(['percent', 'flat', 'free_shipping']);

@Injectable()
export class MockAdminCouponApi extends AdminCouponApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);

  private async build(): Promise<AdminCoupon[]> {
    const overlay = this.state.read().coupons;
    const orders = await loadOrders(this.state);
    const base = COUPONS.map((c) => ({ code: c.code, description: c.description, kind: c.kind, value: c.value, minSubtotal: c.minSubtotal, ...(c.maxDiscount !== undefined ? { maxDiscount: c.maxDiscount } : {}), ...(c.expiresAt ? { expiresAt: c.expiresAt } : {}), active: true }));
    const merged = new Map<string, Omit<AdminCoupon, 'usageCount'>>(base.map((c) => [c.code, overlay[c.code] ?? c]));
    for (const [code, c] of Object.entries(overlay)) merged.set(code, c);
    return [...merged.values()].map((c) => ({ ...c, usageCount: orders.filter((e) => e.order.couponCode === c.code).length })).sort((a, b) => a.code.localeCompare(b.code));
  }

  list() {
    return this.respond.okAsync<AdminCoupon[]>(async () => {
      this.state.require('coupon:write');
      return this.build();
    });
  }

  save(coupon: Omit<AdminCoupon, 'usageCount'>, isNew: boolean) {
    return this.respond.okAsync<AdminCoupon[]>(async () => {
      this.state.require('coupon:write');
      const code = coupon.code.trim().toUpperCase();
      const fields: Record<string, string> = {};
      if (!/^[A-Z0-9]{3,20}$/.test(code)) fields['code'] = 'Use 3 to 20 letters or numbers';
      if (!coupon.description.trim()) fields['description'] = 'Description is required';
      if (!COUPON_KINDS.has(coupon.kind)) fields['kind'] = 'Choose a type';
      if (coupon.kind === 'percent' && !(coupon.value >= 1 && coupon.value <= 90)) fields['value'] = 'Percent must be between 1 and 90';
      if (coupon.kind === 'flat' && !(coupon.value > 0)) fields['value'] = 'Amount must be greater than zero';
      if (coupon.minSubtotal < 0) fields['minSubtotal'] = 'Minimum cannot be negative';
      if (coupon.maxDiscount !== undefined && coupon.maxDiscount <= 0) fields['maxDiscount'] = 'Cap must be greater than zero';
      const existing = await this.build();
      if (isNew && existing.some((c) => c.code === code)) fields['code'] = 'This code already exists';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      this.state.update((o) => {
        o.coupons[code] = { ...coupon, code, description: coupon.description.trim() };
      });
      this.state.record(isNew ? 'coupon.create' : 'coupon.update', code, coupon.description.trim());
      return this.build();
    });
  }

  setActive(code: string, active: boolean) {
    return this.respond.okAsync<AdminCoupon[]>(async () => {
      this.state.require('coupon:write');
      const current = (await this.build()).find((c) => c.code === code);
      if (!current) throw new ApiException('not_found', 'Coupon not found');
      const { usageCount: _u, ...rest } = current;
      this.state.update((o) => {
        o.coupons[code] = { ...rest, active };
      });
      this.state.record('coupon.toggle', code, active ? 'Activated' : 'Deactivated');
      return this.build();
    });
  }
}

// ---------- users ----------

@Injectable()
export class MockAdminUserApi extends AdminUserApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly users = inject(MockUserStore);

  private async build(): Promise<AdminUser[]> {
    await this.users.ensureSeeded();
    const roles = this.state.read().roles;
    const orders = await loadOrders(this.state);
    const count = (email: string) => orders.filter((e) => e.order.contact.email === email).length;
    const real = this.users.users().map((u) => ({ id: u.id, name: u.name, email: u.email, roles: roles[u.id] ?? u.roles, emailVerified: u.emailVerified, createdAt: u.createdAt, ordersCount: count(u.email) }));
    const seeded = SEED_CUSTOMERS.map((c, i) => ({ id: c.id, name: c.name, email: c.email, roles: roles[c.id] ?? (['customer'] as Role[]), emailVerified: true, createdAt: new Date(Date.now() - (i * 5 + 2) * DAY).toISOString(), ordersCount: count(c.email) }));
    return [...real, ...seeded].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  list() {
    return this.respond.okAsync<AdminUser[]>(async () => {
      this.state.require('user:read');
      return this.build();
    });
  }

  setRole(userId: string, role: Role, granted: boolean) {
    return this.respond.okAsync<AdminUser[]>(async () => {
      const actor = this.state.require('user:read');
      if (role !== 'admin') throw new ApiException('validation', 'Only the admin role can be changed here.');
      if (userId === actor.id) throw new ApiException('validation', 'You cannot change your own role.');
      const all = await this.build();
      const target = all.find((u) => u.id === userId);
      if (!target) throw new ApiException('not_found', 'User not found');
      const next: Role[] = granted ? [...new Set<Role>([...target.roles, 'admin'])] : target.roles.filter((r) => r !== 'admin');
      if (next.length === 0) next.push('customer');
      if (!granted && all.filter((u) => u.roles.includes('admin')).length <= 1) throw new ApiException('validation', 'At least one admin must remain.');
      this.state.update((o) => {
        o.roles[userId] = next;
      });
      const stored = this.users.users().find((u) => u.id === userId);
      if (stored) this.users.update({ ...stored, roles: next });
      this.state.record('user.role', target.email, `${granted ? 'Granted' : 'Revoked'} admin`);
      return this.build();
    });
  }
}

// ---------- dashboard and audit ----------

@Injectable()
export class MockAdminDashboardApi extends AdminDashboardApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly users = inject(MockUserStore);

  metrics(days: number) {
    return this.respond.okAsync<DashboardMetrics>(async () => {
      this.state.require('order:read:any');
      const orders = (await loadOrders(this.state)).map((e) => e.order);
      const since = Date.now() - days * DAY;
      const inPeriod = orders.filter((o) => new Date(o.createdAt).getTime() >= since);
      const counted = inPeriod.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_payment');
      const revenue = counted.reduce((s, o) => s + o.totals.total.amount, 0);

      const byDay = new Map<string, { revenue: number; orders: number }>();
      for (let i = days - 1; i >= 0; i--) byDay.set(new Date(Date.now() - i * DAY).toISOString().slice(0, 10), { revenue: 0, orders: 0 });
      for (const o of counted) {
        const bucket = byDay.get(o.createdAt.slice(0, 10));
        if (bucket) {
          bucket.revenue += o.totals.total.amount;
          bucket.orders += 1;
        }
      }
      const statuses = new Map<OrderStatus, number>();
      for (const o of inPeriod) statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);
      const units = new Map<string, { title: string; units: number; revenue: number }>();
      for (const o of counted) {
        for (const l of o.lines) {
          const u = units.get(l.productId) ?? { title: l.title, units: 0, revenue: 0 };
          u.units += l.quantity;
          u.revenue += l.lineTotal.amount;
          units.set(l.productId, u);
        }
      }
      const products = await loadProducts(this.state);
      // Per-variant thresholds and reservations come from the inventory ledger.
      const lowStock = this.state.inventory
        .rows(products.filter((e) => e.status === 'published').map((e) => e.baseline))
        .filter((r) => r.low)
        .map((r) => ({ title: r.title, sku: r.sku, stock: Math.max(r.available, 0) }))
        .sort((a, b) => a.stock - b.stock || a.title.localeCompare(b.title))
        .slice(0, 8);

      return {
        days,
        revenue: inr(revenue),
        orders: counted.length,
        averageOrderValue: inr(counted.length ? revenue / counted.length : 0),
        newCustomers: SEED_CUSTOMERS.filter((_, i) => Date.now() - (i * 5 + 2) * DAY >= since).length + this.users.users().filter((u) => new Date(u.createdAt).getTime() >= since && !u.roles.includes('admin')).length,
        byDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
        statusBreakdown: [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
        topProducts: [...units.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((u) => ({ title: u.title, units: u.units, revenue: inr(u.revenue) })),
        lowStock,
      };
    });
  }
}

@Injectable()
export class MockAuditApi extends AuditApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);

  list(query: { q?: string; page: number; pageSize: number }) {
    return this.respond.okAsync<Paged<AuditEntry>>(async () => {
      this.state.require('user:read');
      const q = query.q?.trim().toLowerCase();
      const rows = this.state.read().audit.filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(q));
      const pageSize = Math.max(1, query.pageSize);
      const page = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
      return { total: rows.length, page, pageSize, items: rows.slice((page - 1) * pageSize, page * pageSize) };
    });
  }
}

// ---------- review moderation ----------

const SEED_REVIEW_TEXT: { rating: number; title: string; body: string; flag?: string }[] = [
  { rating: 1, title: 'Total scam', body: 'The seller is a fraud, do not buy anything here.', flag: 'Contains blocked language' },
  { rating: 5, title: 'Best deals', body: 'Find cheaper prices at www.dealz.example right now.', flag: 'Contains a link' },
  { rating: 2, title: 'Stopped working', body: 'Broke after two weeks. Support was slow to respond.', flag: 'Edited after approval' },
  { rating: 1, title: 'Stupid design', body: 'Whoever designed this is an idiot, terrible product.', flag: 'Contains blocked language' },
  { rating: 4, title: 'Good but pricey', body: 'Quality is good, though it costs more than similar items.', flag: 'Edited after approval' },
  { rating: 5, title: 'Visit my store', body: 'Great item! Check https://spam.example for coupons.', flag: 'Contains a link' },
  { rating: 3, title: 'Average', body: 'Does the job. Packaging could be better and delivery was late.', flag: 'Reported by a customer' },
  { rating: 1, title: 'Cheat', body: 'They cheat customers with fake discounts.', flag: 'Contains blocked language' },
];

@Injectable()
export class MockAdminReviewApi extends AdminReviewApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);

  /** Seeded review queue with the moderator's decisions applied. */
  private async build(): Promise<AdminReviewRow[]> {
    const { products } = await loadCatalogData();
    const decisions = this.state.read().reviewDecisions;
    const names = ['Aarav S.', 'Diya M.', 'Rohan K.', 'Ananya P.', 'Vihaan R.', 'Ishita G.', 'Kabir N.', 'Meera T.'];
    return SEED_REVIEW_TEXT.map((r, i): AdminReviewRow => {
      const product = products[(i * 29 + 5) % products.length];
      const id = `rv_seed_${i + 1}`;
      const decision = decisions[id];
      return {
        id,
        productId: product.id,
        productTitle: product.title,
        author: names[i % names.length],
        rating: r.rating,
        title: r.title,
        body: r.body,
        status: decision && decision !== 'deleted' ? decision : 'pending',
        ...(r.flag ? { flagReason: r.flag } : {}),
        createdAt: new Date(Date.now() - (i + 1) * DAY).toISOString(),
      };
    }).filter((r) => decisions[r.id] !== 'deleted');
  }

  list(query: { status?: AdminReviewRow['status']; page: number; pageSize: number }) {
    return this.respond.okAsync<Paged<AdminReviewRow>>(async () => {
      this.state.require('review:moderate');
      const rows = (await this.build()).filter((r) => !query.status || r.status === query.status);
      const pageSize = Math.max(1, query.pageSize);
      const page = Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(rows.length / pageSize)));
      return { total: rows.length, page, pageSize, items: rows.slice((page - 1) * pageSize, page * pageSize) };
    });
  }

  pendingCount() {
    return this.respond.okAsync<number>(async () => {
      this.state.require('review:moderate');
      return (await this.build()).filter((r) => r.status === 'pending').length;
    });
  }

  moderate(id: string, decision: 'approved' | 'rejected') {
    return this.respond.okAsync<AdminReviewRow>(async () => {
      this.state.require('review:moderate');
      const row = (await this.build()).find((r) => r.id === id);
      if (!row) throw new ApiException('not_found', 'Review not found');
      this.state.update((o) => {
        o.reviewDecisions[id] = decision;
      });
      this.state.record('review.moderate', row.productTitle, `${decision === 'approved' ? 'Approved' : 'Rejected'} review "${row.title}"`);
      return { ...row, status: decision };
    });
  }

  remove(id: string) {
    return this.respond.okAsync<void>(async () => {
      this.state.require('review:moderate');
      const row = (await this.build()).find((r) => r.id === id);
      if (!row) throw new ApiException('not_found', 'Review not found');
      this.state.update((o) => {
        o.reviewDecisions[id] = 'deleted';
      });
      this.state.record('review.delete', row.productTitle, `Deleted review "${row.title}"`);
    });
  }
}
