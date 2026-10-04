import type { Observable } from 'rxjs';
import type { ApplyWalletInput, DealView, GiftCard, GiftCardCheck, IssueGiftCardInput, PriceHealthIssue, Promotion, PromotionInput, SimulationInput, SimulationResult, WalletSummary } from '@ecom/contracts';

/**
 * Shop side of promotions (BRD 14). Automatic offers are applied by the cart itself; this only exposes what the
 * shop needs to *display*, like running flash deals. Nothing here decides a price.
 */
export abstract class PromotionApi {
  /** Flash deals that are live now (started, not ended, not sold out), soonest ending first. */
  abstract activeDeals(): Observable<DealView[]>;
  /** The live flash deal for a product, or null. */
  abstract dealFor(productId: string): Observable<DealView | null>;
}

/** Gift cards and store credit at checkout (PE-05). Balances never go below zero; every use is recorded. */
export abstract class WalletApi {
  /** Store credit for the signed-in customer; zero for guests. */
  abstract summary(): Observable<WalletSummary>;
  /** Checks a gift card code without using it. Errors: `validation` with a reason. */
  abstract checkGiftCard(code: string): Observable<GiftCardCheck>;
  /** Puts a gift card and/or store credit on the cart. The cart then prices it; re-read the cart afterwards. */
  abstract apply(input: ApplyWalletInput): Observable<void>;
}

/** Staff promotions. Needs `promotion:manage`; every change is audited. */
export abstract class AdminPromotionApi {
  abstract list(): Observable<Promotion[]>;
  /** Creates (no `id`) or replaces a promotion. Errors: `validation` with field messages. */
  abstract save(input: PromotionInput): Observable<Promotion>;
  abstract setEnabled(id: string, enabled: boolean): Observable<Promotion>;
  abstract remove(id: string): Observable<void>;
  /** Runs a sample cart through the real engine and explains every rule (PE-06). Changes nothing. */
  abstract simulate(input: SimulationInput): Observable<SimulationResult>;
  /** Variants whose MRP is not a believable earlier price (PE-07). */
  abstract priceHealth(): Observable<PriceHealthIssue[]>;
}

/** Staff gift cards. Needs `promotion:manage`. */
export abstract class AdminGiftCardApi {
  abstract list(): Observable<GiftCard[]>;
  abstract issue(input: IssueGiftCardInput): Observable<GiftCard>;
  abstract setStatus(code: string, status: GiftCard['status']): Observable<GiftCard>;
}
