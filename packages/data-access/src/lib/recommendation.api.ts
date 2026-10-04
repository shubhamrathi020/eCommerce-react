import type { Observable } from 'rxjs';
import type { RecConfig, RecPreview, RecRow, RecStats } from '@ecom/contracts';

/**
 * Recommendation rows (BRD 15). Rows are explainable: each item carries the reason it is shown. A row that would be thin
 * comes back as `null` so the page simply leaves it out. Rows must load after the main content (RC non-functional note).
 */
export abstract class RecommendationApi {
  /** Rows for a product page. The current product is never in them. */
  abstract forProduct(productId: string): Observable<{ similar: RecRow | null; together: RecRow | null }>;
  /**
   * Rows for the home page. `personalised` falls back to popular items for a new visitor, an opted-out one, or someone
   * without enough history, and says so (`coldStart`).
   */
  abstract home(): Observable<{ personalised: RecRow | null; trending: RecRow | null; bestSellers: RecRow | null }>;
  /** How many events this browser has recorded. */
  abstract historyCount(): Observable<number>;
  /** Deletes this browser's recorded behaviour and starts a new anonymous identity (RC-06). */
  abstract clearHistory(): Observable<void>;
}

/** Staff controls for recommendations. Needs `recommendation:manage`; changes are audited and apply immediately (RC-05). */
export abstract class AdminRecommendationApi {
  abstract config(): Observable<RecConfig>;
  abstract saveConfig(input: Pick<RecConfig, 'strategies' | 'pinned' | 'excluded' | 'boosts' | 'minTogether'>): Observable<RecConfig>;
  /** What shoppers would see: the home rows for a brand-new visitor, or the rows for one product. */
  abstract preview(productId?: string): Observable<RecPreview>;
  abstract stats(): Observable<RecStats>;
}
