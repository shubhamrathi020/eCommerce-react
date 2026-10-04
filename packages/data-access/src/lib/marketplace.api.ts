import type { Observable } from 'rxjs';
import type {
  CommissionRule,
  Money,
  PayoutPreview,
  PayoutStatement,
  PublicSeller,
  Seller,
  SellerApplicationInput,
  SellerProduct,
  SellerProductInput,
  SellerShipmentView,
  SellerStatus,
} from '@ecom/contracts';

/** What shoppers may see of a seller (MP-05): name, rating from reviews of their products, and their policies. */
export abstract class SellerPublicApi {
  /** `null` for the store's own products and for sellers that are not in good standing. */
  abstract profile(sellerId: string): Observable<PublicSeller | null>;
}

/** An assigned catalog item, shown to its seller read-only. */
export interface AssignedItem {
  productId: string;
  title: string;
  price: Money;
  stock: number;
  rating: { average: number; count: number };
}

export interface SellerPayouts {
  /** Delivered sales not yet on a statement: what the next statement would contain. */
  upcoming: PayoutPreview;
  statements: PayoutStatement[];
}

/**
 * The seller portal's API (BRD 17). Which seller is calling is always derived from the signed-in user, never passed in, so a
 * seller can only ever reach their own data: another seller's ids answer "not found", and customer details are limited to what is
 * needed to ship (business rule 1). Errors: `unauthorized`, `forbidden`, `validation`, `not_found`, `conflict`.
 */
export abstract class SellerPortalApi {
  /** The signed-in user's store, if they have applied; null if they have not. */
  abstract me(): Observable<Seller | null>;
  /** Applies (or re-applies after a rejection) to sell. Needs a signed-in account; an admin must approve it. */
  abstract apply(input: SellerApplicationInput): Observable<Seller>;

  abstract products(): Observable<SellerProduct[]>;
  abstract assignedItems(): Observable<AssignedItem[]>;
  /** Creates (no `id`) or edits a listing. Price, MRP and stock changes keep a live listing live; any other change sends it back for approval. */
  abstract saveProduct(input: SellerProductInput): Observable<SellerProduct>;
  /** Sends a draft or rejected listing for admin approval (MP-06). */
  abstract submitProduct(id: string): Observable<SellerProduct>;
  abstract deleteProduct(id: string): Observable<void>;
  /** Sets the units on hand (MP-02 inventory). */
  abstract setStock(id: string, stock: number): Observable<SellerProduct>;

  abstract shipments(): Observable<SellerShipmentView[]>;
  /** Moves a shipment one step: packed, shipped (needs a tracking number) or delivered. */
  abstract advanceShipment(id: string, trackingNumber?: string): Observable<SellerShipmentView>;

  abstract payouts(): Observable<SellerPayouts>;
}

export interface SellerWithCounts extends Seller {
  liveProducts: number;
  pendingProducts: number;
}

export interface AdminSellerProduct extends SellerProduct {
  sellerName: string;
}

export interface CommissionRuleInput {
  id?: string;
  scope: CommissionRule['scope'];
  categoryId?: string;
  sellerId?: string;
  percent: number;
}

/** Staff marketplace tools. Needs `seller:manage`; every decision is audited and the applicant is notified. */
export abstract class AdminSellerApi {
  abstract sellers(status?: SellerStatus): Observable<SellerWithCounts[]>;
  /** Approves an application (the applicant gains seller access) or rejects it with a reason they will see. */
  abstract decideSeller(id: string, decision: { approve: boolean; reason?: string }): Observable<Seller>;
  /** Suspends an approved seller (their listings go off sale) or restores them. */
  abstract setStanding(id: string, status: 'approved' | 'suspended'): Observable<Seller>;
  /** A seller-specific commission percent, or `null` to fall back to the rules. */
  abstract setCommission(id: string, percent: number | null): Observable<Seller>;

  abstract products(status?: SellerProduct['status']): Observable<AdminSellerProduct[]>;
  abstract decideProduct(id: string, decision: { approve: boolean; reason?: string }): Observable<SellerProduct>;

  abstract rules(): Observable<CommissionRule[]>;
  abstract saveRule(input: CommissionRuleInput): Observable<CommissionRule>;
  abstract removeRule(id: string): Observable<void>;

  /** What a statement would hold, without creating it. */
  abstract payoutPreview(sellerId: string, from: string, to: string): Observable<PayoutPreview>;
  /** Creates a statement from delivered shipments and refunded returns in the period; they cannot go on another one. */
  abstract issuePayout(sellerId: string, from: string, to: string): Observable<PayoutStatement>;
  abstract statements(): Observable<PayoutStatement[]>;
  /** Records that the statement was paid out of band (no money moves in this demo). */
  abstract markPaid(statementId: string, reference: string): Observable<PayoutStatement>;
}
