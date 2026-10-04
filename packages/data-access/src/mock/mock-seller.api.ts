import { Injectable, inject } from '@shop/core';
import type { Order, PublicSeller, Seller, SellerApplicationInput, SellerProduct, SellerProductInput, SellerShipmentView, Shipment } from '@ecom/contracts';
import { ApiException, SELLER_NEXT, sellerApplicationProblems, sellerProductProblems, sellerRating } from '@ecom/contracts';
import { type AssignedItem, SellerPortalApi, type SellerPayouts, SellerPublicApi } from '../lib/marketplace.api';
import { loadCatalogData } from './catalog-data';
import { MockInventoryStore } from './inventory-store';
import { createMockResponder } from './mock-latency';
import { MockNotificationStore } from './notification-store';
import { MockOrderStore } from './mock-order-store';
import { MockReviewStore, applyReviewOverlay } from './mock-review-store';
import { MockUserStore } from './mock-user-store';
import { PayoutCalculator, isoDate } from './payouts';
import { MockSellerStore, newSellerId } from './seller-store';

/** Products with their approved-review ratings applied, as shoppers see them. */
export async function ratedProducts(reviews: MockReviewStore) {
  const { products } = await loadCatalogData();
  return applyReviewOverlay(products, reviews.approved());
}

@Injectable()
export class MockSellerPublicApi extends SellerPublicApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockSellerStore);
  private readonly reviews = inject(MockReviewStore);

  profile(sellerId: string) {
    return this.respond.okAsync<PublicSeller | null>(async () => {
      const seller = this.store.seller(sellerId);
      if (!seller || seller.status !== 'approved') return null;
      // A seller's rating is the review-weighted mean of the ratings of their products, so it moves when reviews do (MP-05).
      const owned = (await ratedProducts(this.reviews)).filter((p) => p.sellerId === sellerId);
      return { id: seller.id, displayName: seller.displayName, rating: sellerRating(owned), policies: seller.policies, since: seller.appliedAt };
    });
  }
}

const TRACKING = /^[A-Za-z0-9-]{5,30}$/;

@Injectable()
export class MockSellerPortalApi extends SellerPortalApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly store = inject(MockSellerStore);
  private readonly orders = inject(MockOrderStore);
  private readonly inventory = inject(MockInventoryStore);
  private readonly notifications = inject(MockNotificationStore);
  private readonly payoutCalc = inject(PayoutCalculator);
  private readonly reviews = inject(MockReviewStore);

  private signedIn() {
    const session = this.users.session();
    if (!session) throw new ApiException('unauthorized', 'Please sign in.');
    return session.user;
  }

  /** The caller's own approved store. This is the only way an id reaches the data: nothing is looked up by a seller id from the browser. */
  private mySeller(): Seller {
    const user = this.signedIn();
    const seller = this.store.sellerOfUser(user.id);
    if (!seller) throw new ApiException('forbidden', 'Apply to sell first.');
    if (seller.status === 'pending') throw new ApiException('forbidden', 'Your application is still being reviewed.');
    if (seller.status === 'rejected') throw new ApiException('forbidden', 'Your application was not approved.');
    if (seller.status === 'suspended') throw new ApiException('forbidden', 'Your store is suspended. Contact the marketplace team.');
    if (!user.permissions.includes('seller:portal')) throw new ApiException('forbidden', 'Sign in again to open your seller portal.');
    return seller;
  }

  me() {
    return this.respond.okAsync<Seller | null>(async () => this.store.sellerOfUser(this.signedIn().id) ?? null);
  }

  apply(input: SellerApplicationInput) {
    return this.respond.okAsync<Seller>(async () => {
      const user = this.signedIn();
      const fields = sellerApplicationProblems(input);
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const existing = this.store.sellerOfUser(user.id);
      if (existing && existing.status !== 'rejected') throw new ApiException('conflict', existing.status === 'pending' ? 'You have already applied. We will email you when it is reviewed.' : 'You already have a store.');
      const now = new Date().toISOString();
      const seller: Seller = {
        id: existing?.id ?? newSellerId('sel'),
        ownerUserId: user.id,
        displayName: input.displayName.trim(),
        legalName: input.legalName.trim(),
        phone: input.phone.trim(),
        gstin: input.gstin.trim().toUpperCase(),
        pan: input.pan.trim().toUpperCase(),
        address: { line1: input.address.line1.trim(), city: input.address.city.trim(), state: input.address.state.trim(), pincode: input.address.pincode.trim() },
        bankHolder: input.bankHolder.trim(),
        bankIfsc: input.bankIfsc.trim().toUpperCase(),
        // Only the last four digits are kept (see Seller.bankAccountLast4).
        bankAccountLast4: input.bankAccountNumber.trim().slice(-4),
        policies: { returns: input.policies.returns.trim(), shipping: input.policies.shipping.trim() },
        status: 'pending',
        appliedAt: now,
      };
      this.store.transact((s) => {
        s.sellers = [...s.sellers.filter((x) => x.id !== seller.id), seller];
      });
      return seller;
    });
  }

  // ---------- products ----------

  private ownProduct(sellerId: string, id: string): SellerProduct {
    // A product that exists but belongs to someone else answers exactly like one that does not exist.
    const found = this.store.products().find((p) => p.id === id && p.sellerId === sellerId);
    if (!found) throw new ApiException('not_found', 'Product not found');
    return found;
  }

  products() {
    return this.respond.okAsync<SellerProduct[]>(async () => {
      const seller = this.mySeller();
      return this.store
        .products()
        .filter((p) => p.sellerId === seller.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  assignedItems() {
    return this.respond.okAsync<AssignedItem[]>(async () => {
      const seller = this.mySeller();
      const owned = (await ratedProducts(this.reviews)).filter((p) => p.sellerId === seller.id && !this.store.products().some((sp) => sp.id === p.id));
      return this.inventory.apply(owned, 'onHand').map((p) => ({ productId: p.id, title: p.title, price: p.variants[0].price, stock: p.variants.reduce((n, v) => n + v.stock, 0), rating: { average: p.rating.average, count: p.rating.count } }));
    });
  }

  saveProduct(input: SellerProductInput) {
    return this.respond.okAsync<SellerProduct>(async () => {
      const seller = this.mySeller();
      const { categories } = await loadCatalogData();
      const fields = sellerProductProblems(input, (id) => categories.some((c) => c.id === id && c.parentId !== undefined));
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const now = new Date().toISOString();
      return this.store.transact((s) => {
        if (!input.id) {
          const created: SellerProduct = { id: newSellerId('sp'), sellerId: seller.id, title: input.title.trim(), brandName: input.brandName.trim(), categoryId: input.categoryId, description: input.description.trim(), price: input.price, ...(input.mrp ? { mrp: input.mrp } : {}), stock: input.stock, status: 'draft', createdAt: now, updatedAt: now };
          s.products.push(created);
          return created;
        }
        const own = s.products.find((p) => p.id === input.id && p.sellerId === seller.id);
        if (!own) throw new ApiException('not_found', 'Product not found');
        // A live listing needs approval again only when what shoppers read about it changes; price, MRP and stock do not.
        const textChanged = own.title !== input.title.trim() || own.brandName !== input.brandName.trim() || own.categoryId !== input.categoryId || own.description !== input.description.trim();
        Object.assign(own, { title: input.title.trim(), brandName: input.brandName.trim(), categoryId: input.categoryId, description: input.description.trim(), price: input.price, stock: input.stock, updatedAt: now });
        if (input.mrp) own.mrp = input.mrp;
        else delete own.mrp;
        if (own.status === 'approved' && textChanged) own.status = 'pending';
        return own;
      });
    });
  }

  submitProduct(id: string) {
    return this.respond.okAsync<SellerProduct>(async () => {
      const seller = this.mySeller();
      this.ownProduct(seller.id, id);
      return this.store.transact((s) => {
        const p = s.products.find((x) => x.id === id && x.sellerId === seller.id) as SellerProduct;
        if (p.status !== 'draft' && p.status !== 'rejected') throw new ApiException('validation', p.status === 'pending' ? 'This listing is already waiting for approval.' : 'This listing is already live.');
        p.status = 'pending';
        delete p.rejectionReason;
        p.updatedAt = new Date().toISOString();
        return p;
      });
    });
  }

  deleteProduct(id: string) {
    return this.respond.okAsync<void>(async () => {
      const seller = this.mySeller();
      const p = this.ownProduct(seller.id, id);
      if (p.status === 'approved' || p.status === 'pending') throw new ApiException('validation', 'Only a draft or rejected listing can be deleted.');
      this.store.transact((s) => {
        s.products = s.products.filter((x) => x.id !== id);
      });
    });
  }

  setStock(id: string, stock: number) {
    return this.respond.okAsync<SellerProduct>(async () => {
      const seller = this.mySeller();
      this.ownProduct(seller.id, id);
      if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) throw new ApiException('validation', 'Enter a whole number of units from 0 to 100,000.', { stock: 'Enter 0 to 100,000' });
      // Sales and cancellations are in the stock ledger on top of the listing's own figure, so the listing figure is the target minus what the ledger says.
      const ledger = this.inventory.movements().filter((m) => m.variantId === `${id}-v1`).reduce((n, m) => n + m.quantity, 0);
      return this.store.transact((s) => {
        const p = s.products.find((x) => x.id === id && x.sellerId === seller.id) as SellerProduct;
        p.stock = stock - ledger;
        p.updatedAt = new Date().toISOString();
        return { ...p, stock };
      });
    });
  }

  // ---------- orders ----------

  private view(sh: Shipment, order: Order): SellerShipmentView {
    return {
      id: sh.id,
      orderId: order.id,
      placedAt: order.createdAt,
      status: sh.status,
      ...(sh.trackingNumber ? { trackingNumber: sh.trackingNumber } : {}),
      // Only this seller's own lines; other sellers' items and the order totals are not shown.
      items: order.lines.filter((l) => sh.variantIds.includes(l.variantId)).map((l) => ({ title: l.title, options: l.options, quantity: l.quantity, unitPrice: l.unitPrice })),
      // Ship-to details only: no email and no payment information.
      shipTo: { name: order.contact.name, phone: order.contact.phone, line1: order.address.line1, ...(order.address.line2 ? { line2: order.address.line2 } : {}), city: order.address.city, state: order.address.state, pincode: order.address.pincode },
      timeline: sh.timeline,
    };
  }

  shipments() {
    return this.respond.okAsync<SellerShipmentView[]>(async () => {
      const seller = this.mySeller();
      return this.store
        .shipments()
        .filter((sh) => sh.sellerId === seller.id)
        .flatMap((sh) => {
          const order = this.orders.find(sh.orderId);
          // Unpaid and cancelled orders are not the seller's to fulfil.
          return order && order.status !== 'pending_payment' && order.status !== 'cancelled' && sh.status !== 'cancelled' ? [this.view(sh, order)] : [];
        })
        .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    });
  }

  advanceShipment(id: string, trackingNumber?: string) {
    return this.respond.okAsync<SellerShipmentView>(async () => {
      const seller = this.mySeller();
      const sh = this.store.shipments().find((x) => x.id === id && x.sellerId === seller.id);
      if (!sh) throw new ApiException('not_found', 'Shipment not found');
      const order = this.orders.find(sh.orderId);
      if (!order || order.status === 'pending_payment' || order.status === 'cancelled' || sh.status === 'cancelled') throw new ApiException('validation', 'This order is not ready to be fulfilled.');
      const next = SELLER_NEXT[sh.status];
      if (!next) throw new ApiException('validation', 'This shipment is already delivered.');
      const tracking = trackingNumber?.trim();
      if (next === 'shipped' && !(tracking && TRACKING.test(tracking))) throw new ApiException('validation', 'Enter the courier tracking number (5 to 30 letters, digits or hyphens).', { trackingNumber: 'Enter a valid tracking number' });
      const at = new Date().toISOString();
      const updated = this.store.transact((s) => {
        const x = s.shipments.find((y) => y.id === id) as Shipment;
        x.status = next;
        x.timeline = [...x.timeline, { status: next, at }];
        if (next === 'shipped') x.trackingNumber = tracking as string;
        return { ...x };
      });
      this.notifications.deliver('shipment_update', order.contact.email, { name: order.contact.name, orderId: order.id, seller: seller.displayName, status: next }, { userId: order.userId, link: `/orders/${order.id}` });
      return this.view(updated, order);
    });
  }

  payouts() {
    return this.respond.okAsync<SellerPayouts>(async () => {
      const seller = this.mySeller();
      const upcoming = await this.payoutCalc.preview(seller.id, '2000-01-01', isoDate(Date.now() + 86_400_000), true);
      return { upcoming, statements: this.store.statements().filter((st) => st.sellerId === seller.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) };
    });
  }
}
