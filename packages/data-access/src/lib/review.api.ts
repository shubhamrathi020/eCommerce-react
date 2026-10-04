import type { Observable } from 'rxjs';
import type { Review, ReviewEligibility, ReviewInput } from '@ecom/contracts';

/**
 * Writing side of reviews (reading is `CatalogApi.reviews`). Errors are `ApiException`s:
 * `unauthorized`, `forbidden` (not a verified buyer), `validation`, `not_found`.
 */
export abstract class ReviewApi {
  abstract eligibility(productId: string): Observable<ReviewEligibility>;
  /** Goes live at once when the text passes the checks, otherwise is held for moderation. */
  abstract submit(input: ReviewInput): Observable<Review>;
  abstract updateMine(reviewId: string, input: Omit<ReviewInput, 'productId'>): Observable<Review>;
  abstract removeMine(reviewId: string): Observable<void>;
  /** Toggles the caller's "helpful" vote; returns the new state and count. */
  abstract vote(reviewId: string): Observable<{ voted: boolean; helpful: number }>;
}
