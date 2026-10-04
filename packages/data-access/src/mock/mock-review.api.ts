import { Injectable, inject } from '@shop/core';
import type { Review, ReviewEligibility, ReviewInput } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { ReviewApi } from '../lib/review.api';
import { createMockResponder } from './mock-latency';
import { MockOrderStore } from './mock-order-store';
import { MockReviewStore, type StoredReview, reviewFlag } from './mock-review-store';
import { MockNotificationStore } from './notification-store';
import { MockUserStore } from './mock-user-store';

export const REVIEW_LIMITS = { titleMax: 80, bodyMin: 10, bodyMax: 1000 };

function validate(input: { rating: number; title: string; body: string }): void {
  const fields: Record<string, string> = {};
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) fields['rating'] = 'Choose a rating from 1 to 5 stars';
  const title = input.title.trim();
  if (!title) fields['title'] = 'Add a short title';
  else if (title.length > REVIEW_LIMITS.titleMax) fields['title'] = `Keep the title under ${REVIEW_LIMITS.titleMax} characters`;
  const body = input.body.trim();
  if (body.length < REVIEW_LIMITS.bodyMin) fields['body'] = `Write at least ${REVIEW_LIMITS.bodyMin} characters`;
  else if (body.length > REVIEW_LIMITS.bodyMax) fields['body'] = `Keep the review under ${REVIEW_LIMITS.bodyMax} characters`;
  if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
}

const displayName = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

@Injectable()
export class MockReviewApi extends ReviewApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly store = inject(MockReviewStore);
  private readonly orders = inject(MockOrderStore);
  private readonly notifications = inject(MockNotificationStore);

  private requireUser() {
    const session = this.users.session();
    if (!session) throw new ApiException('unauthorized', 'Please sign in to review products.');
    return session.user;
  }

  /** A confirmed (or later) order of this customer contains the product. */
  private hasPurchased(userId: string, productId: string): boolean {
    return this.orders.all().some((o) => o.userId === userId && o.status !== 'cancelled' && o.status !== 'pending_payment' && o.lines.some((l) => l.productId === productId));
  }

  eligibility(productId: string) {
    return this.respond.okAsync<ReviewEligibility>(async () => {
      const session = this.users.session();
      if (!session) return { canReview: false, reason: 'sign_in' as const };
      const existing = this.store.read().reviews.find((r) => r.userId === session.user.id && r.productId === productId);
      if (existing) return { canReview: false, existing: this.store.view(existing) };
      if (!this.hasPurchased(session.user.id, productId)) return { canReview: false, reason: 'not_purchased' as const };
      return { canReview: true };
    });
  }

  submit(input: ReviewInput) {
    return this.respond.okAsync<Review>(async () => {
      const user = this.requireUser();
      if (!this.hasPurchased(user.id, input.productId)) throw new ApiException('forbidden', 'Only customers who bought this product can review it.');
      validate(input);
      const overlay = this.store.read();
      if (overlay.reviews.some((r) => r.userId === user.id && r.productId === input.productId)) throw new ApiException('validation', 'You have already reviewed this product.');
      const flagReason = reviewFlag(input.title, input.body);
      const review: StoredReview = {
        id: `rv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        productId: input.productId,
        author: displayName(user.name),
        rating: input.rating,
        title: input.title.trim(),
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
        verified: true,
        helpful: 0,
        status: flagReason ? 'pending' : 'approved',
        userId: user.id,
        ...(flagReason ? { flagReason } : {}),
      };
      this.store.write({ ...overlay, reviews: [review, ...overlay.reviews] });
      // No product slug is available here, only its id, so the notification carries no link.
      this.notifications.deliver('review_status', user.email, { name: user.name, title: review.title, status: flagReason ? 'is awaiting a quick check before it goes live' : 'is now live on the product page' }, { userId: user.id });
      return this.store.view(review);
    });
  }

  updateMine(reviewId: string, input: Omit<ReviewInput, 'productId'>) {
    return this.respond.okAsync<Review>(async () => {
      const user = this.requireUser();
      validate(input);
      const overlay = this.store.read();
      const found = overlay.reviews.find((r) => r.id === reviewId && r.userId === user.id);
      if (!found) throw new ApiException('not_found', 'Review not found');
      const flagReason = reviewFlag(input.title, input.body);
      const { flagReason: _old, ...rest } = found;
      const updated: StoredReview = { ...rest, rating: input.rating, title: input.title.trim(), body: input.body.trim(), status: flagReason ? 'pending' : 'approved', ...(flagReason ? { flagReason } : {}) };
      this.store.write({ ...overlay, reviews: overlay.reviews.map((r) => (r.id === reviewId ? updated : r)) });
      return this.store.view(updated);
    });
  }

  removeMine(reviewId: string) {
    return this.respond.okAsync<void>(async () => {
      const user = this.requireUser();
      const overlay = this.store.read();
      if (!overlay.reviews.some((r) => r.id === reviewId && r.userId === user.id)) throw new ApiException('not_found', 'Review not found');
      this.store.write({ ...overlay, reviews: overlay.reviews.filter((r) => r.id !== reviewId) });
    });
  }

  vote(reviewId: string) {
    return this.respond.okAsync<{ voted: boolean; helpful: number }>(async () => {
      const user = this.requireUser();
      const overlay = this.store.read();
      const own = overlay.reviews.find((r) => r.id === reviewId);
      if (own?.userId === user.id) throw new ApiException('validation', 'You cannot vote on your own review.');
      const mine = overlay.votes[user.id] ?? [];
      const voted = !mine.includes(reviewId);
      this.store.write({ ...overlay, votes: { ...overlay.votes, [user.id]: voted ? [...mine, reviewId] : mine.filter((id) => id !== reviewId) } });
      return { voted, helpful: this.store.votesFor(reviewId) };
    });
  }
}
