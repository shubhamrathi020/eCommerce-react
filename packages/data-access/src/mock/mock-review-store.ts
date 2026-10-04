import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { Product, RatingSummary, Review } from '@ecom/contracts';
import { MockUserStore } from './mock-user-store';

/** A review written in this browser; `userId` stays server-side and is never returned to clients. */
export interface StoredReview extends Review {
  userId: string;
  flagReason?: string;
}

interface ReviewOverlay {
  reviews: StoredReview[];
  /** userId -> ids of reviews they marked helpful. */
  votes: Record<string, string[]>;
}

const KEY = 'ecom.mock.reviews.v1';

const BLOCKED_WORDS = ['scam', 'fraud', 'idiot', 'stupid', 'garbage seller', 'cheat'];
const LINK = /(https?:\/\/|www\.)/i;

/** Starter content checks. A real service replaces this with a proper filter. */
export function reviewFlag(title: string, body: string): string | null {
  const text = `${title} ${body}`.toLowerCase();
  if (LINK.test(text)) return 'Contains a link';
  const word = BLOCKED_WORDS.find((w) => text.includes(w));
  return word ? 'Contains blocked language' : null;
}

/** Adds approved reviews to a product's rating summary. */
export function mergeRating(base: RatingSummary, added: Review[]): RatingSummary {
  if (added.length === 0) return base;
  const distribution = [...base.distribution] as RatingSummary['distribution'];
  let sum = base.average * base.count;
  for (const r of added) {
    distribution[r.rating - 1]++;
    sum += r.rating;
  }
  const count = base.count + added.length;
  return { average: Math.round((sum / count) * 10) / 10, count, distribution };
}

/** Returns products with new approved reviews counted in their ratings (same array when nothing changed). */
export function applyReviewOverlay(products: Product[], approved: Review[]): Product[] {
  if (approved.length === 0) return products;
  const byProduct = new Map<string, Review[]>();
  for (const r of approved) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  return products.map((p) => (byProduct.has(p.id) ? { ...p, rating: mergeRating(p.rating, byProduct.get(p.id) ?? []) } : p));
}

/** Device-local review storage for the mock adapters. */
@Injectable({ providedIn: 'root' })
export class MockReviewStore {
  private readonly storage = inject(STORAGE);
  private readonly users = inject(MockUserStore);

  read(): ReviewOverlay {
    try {
      const raw = this.storage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<ReviewOverlay>) : {};
      return { reviews: parsed.reviews ?? [], votes: parsed.votes ?? {} };
    } catch {
      return { reviews: [], votes: {} };
    }
  }

  write(overlay: ReviewOverlay): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(overlay));
    } catch {
      // Storage full or blocked.
    }
  }

  approved(): StoredReview[] {
    return this.read().reviews.filter((r) => r.status === 'approved');
  }

  /** Total helpful votes cast on this device for a review. */
  votesFor(reviewId: string): number {
    return Object.values(this.read().votes).filter((v) => v.includes(reviewId)).length;
  }

  votedByCurrentUser(reviewId: string): boolean {
    const id = this.users.currentUserId();
    return !!id && (this.read().votes[id] ?? []).includes(reviewId);
  }

  /** Public shape of a stored review for the current viewer. */
  view(review: StoredReview): Review {
    const { userId, flagReason: _flag, ...rest } = review;
    return { ...rest, helpful: review.helpful + this.votesFor(review.id), mine: userId === this.users.currentUserId(), voted: this.votedByCurrentUser(review.id) };
  }
}
