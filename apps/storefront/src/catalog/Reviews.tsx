import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, type RatingSummary, type Review, type ReviewSort } from '@ecom/contracts';
import { ToastService, useDate, useResource, useService, useSignal } from '@shop/core';
import { CatalogApi, REVIEW_LIMITS, ReviewApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, EmptyState, FormField, Rating, RatingInput, Skeleton, cx, inputClass } from '@shop/ui';

const PAGE_SIZE = 5;

/** Write a new review or edit your own. Server rules (length, checks) are applied by the API; this only guides. */
export function ReviewForm({ productId, existing, onSaved, onCancel }: { productId: string; existing?: Review; onSaved: (review: Review) => void; onCancel: () => void }) {
  const api = useService(ReviewApi);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);

  const ratingError = serverFields['rating'] || (attempted && rating < 1 ? 'Choose a rating from 1 to 5 stars' : '');
  const fieldError = (name: 'title' | 'body'): string => {
    if (serverFields[name]) return serverFields[name];
    if (!attempted) return '';
    const value = name === 'title' ? title : body;
    if (name === 'title') return value.trim() ? '' : 'This field is required';
    if (!value.trim()) return 'This field is required';
    return value.length < REVIEW_LIMITS.bodyMin ? `Write at least ${REVIEW_LIMITS.bodyMin} characters` : '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setServerFields({});
    setAttempted(true);
    if (rating < 1 || !title.trim() || body.trim().length === 0 || body.length < REVIEW_LIMITS.bodyMin) return;
    setBusy(true);
    try {
      const review = existing ? await firstValueFrom(api.updateMine(existing.id, { rating, title, body })) : await firstValueFrom(api.submit({ productId, rating, title, body }));
      onSaved(review);
    } catch (error) {
      if (error instanceof ApiException) {
        setFormError(error.message);
        setServerFields(error.fields ?? {});
      } else {
        setFormError('We could not save your review. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-border p-4" aria-label="Review form">
      {formError && (
        <p className="rounded-md border border-danger p-3 text-sm" role="alert">
          {formError}
        </p>
      )}
      <div>
        <p id="rating-label" className="mb-1 text-sm font-medium">
          Your rating{' '}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        </p>
        <RatingInput label="Your rating" invalid={!!ratingError} value={rating} onChange={(v) => { setRating(v); setServerFields((f) => ({ ...f, rating: '' })); }} />
        {ratingError && (
          <p className="mt-1 text-sm text-danger" role="alert">
            {ratingError}
          </p>
        )}
      </div>
      <FormField label="Title" required error={fieldError('title')}>
        {(f) => <input id={f.id} className={inputClass} maxLength={REVIEW_LIMITS.titleMax} aria-describedby={f.describedBy} aria-invalid={fieldError('title') ? 'true' : undefined} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </FormField>
      <FormField label="Your review" required error={fieldError('body')} hint={`${body.length} / ${REVIEW_LIMITS.bodyMax} characters`}>
        {(f) => <textarea id={f.id} className={inputClass} rows={4} maxLength={REVIEW_LIMITS.bodyMax} aria-describedby={f.describedBy} aria-invalid={fieldError('body') ? 'true' : undefined} value={body} onChange={(e) => setBody(e.target.value)} />}
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {existing ? 'Save review' : 'Submit review'}
        </Button>
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Rating breakdown, review list (sort, load more, helpful votes) and the write/edit flow for verified buyers. */
export function ReviewsSection({ productId, summary }: { productId: string; summary: RatingSummary }) {
  const catalog = useService(CatalogApi);
  const reviewApi = useService(ReviewApi);
  const auth = useService(AuthStore);
  const toast = useService(ToastService);
  const date = useDate();
  const location = useLocation();
  const userId = useSignal(auth.user)?.id ?? null;
  const loggedIn = useSignal(auth.loggedIn);

  const [sort, setSort] = useState<ReviewSort>('recent');
  const [pageNo, setPageNo] = useState(1);
  /** Bumped after any change so the list and the eligibility check reload. */
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState<Review[]>([]);

  const eligibility = useResource(() => reviewApi.eligibility(productId), [reviewApi, productId, userId, version]);
  const page = useResource(() => catalog.reviews(productId, { sort, page: pageNo, pageSize: PAGE_SIZE }), [catalog, productId, sort, pageNo, userId, version]);

  // Reviews loaded so far: page 1 replaces the list, later pages are appended.
  useEffect(() => {
    const items = page.value?.items;
    if (!items || page.loading) return;
    setLoaded((prev) => (pageNo === 1 ? items : [...prev, ...items.filter((r) => !prev.some((p) => p.id === r.id))]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.value]);

  const live = page.value?.summary ?? summary;
  const hasMore = !!page.value && loaded.length < page.value.total;
  const breakdown = useMemo(() => [5, 4, 3, 2, 1].map((stars) => ({ stars, count: live.distribution[stars - 1], percent: live.count ? (live.distribution[stars - 1] / live.count) * 100 : 0 })), [live]);

  const saved = (review: Review) => {
    setFormOpen(false);
    setMessage(review.status === 'pending' ? 'Thanks! Your review is waiting for moderation and will appear once approved.' : 'Thanks! Your review is now live.');
    setPageNo(1);
    setVersion((v) => v + 1);
  };

  const remove = async (review: Review) => {
    try {
      await firstValueFrom(reviewApi.removeMine(review.id));
      setMessage('Your review was deleted.');
      setPageNo(1);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not delete your review.');
    }
  };

  const vote = async (review: Review) => {
    if (!loggedIn) {
      toast.info('Sign in to mark reviews as helpful.');
      return;
    }
    try {
      const result = await firstValueFrom(reviewApi.vote(review.id));
      setLoaded((list) => list.map((r) => (r.id === review.id ? { ...r, voted: result.voted, helpful: review.helpful - (review.voted ? 1 : 0) + (result.voted ? 1 : 0) } : r)));
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not save your vote.');
    }
  };

  const e = eligibility.value;
  const mine = e?.existing;
  return (
    <div>
      <section className="mb-6" aria-labelledby="write-h">
        <h3 id="write-h" className="mb-2 font-semibold">
          Write a review
        </h3>
        {message && (
          <p className="mb-3 rounded-md border border-success p-3 text-sm" role="status">
            {message}
          </p>
        )}
        {e ? (
          formOpen ? (
            <ReviewForm productId={productId} existing={editing ? e.existing : undefined} onSaved={saved} onCancel={() => setFormOpen(false)} />
          ) : mine ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                Your review <Badge tone={mine.status === 'pending' ? 'warning' : 'success'}>{mine.status === 'pending' ? 'Waiting for moderation' : 'Published'}</Badge>
              </p>
              <Rating value={mine.rating} size={14} />
              <p className="font-medium">{mine.title}</p>
              <p className="text-sm">{mine.body}</p>
              <div className="mt-2 flex gap-1">
                <button type="button" className="min-h-11 px-2 text-sm font-medium text-primary hover:underline" onClick={() => { setMessage(''); setEditing(true); setFormOpen(true); }}>
                  Edit
                </button>
                <button type="button" className="min-h-11 px-2 text-sm font-medium text-danger hover:underline" onClick={() => void remove(mine)}>
                  Delete
                </button>
              </div>
            </div>
          ) : e.canReview ? (
            <Button variant="secondary" type="button" onClick={() => { setMessage(''); setEditing(false); setFormOpen(true); }}>
              Write a review
            </Button>
          ) : e.reason === 'sign_in' ? (
            <p className="text-sm text-text-muted">
              <Link to={`/account/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`} className="font-medium text-primary hover:underline">
                Sign in
              </Link>{' '}
              to review products you have bought.
            </p>
          ) : (
            <p className="text-sm text-text-muted">Only customers who bought this product can review it.</p>
          )
        ) : (
          <Skeleton className="h-10" />
        )}
      </section>

      {live.count === 0 ? (
        <EmptyState title="No reviews yet" description="Be the first to review this product after you buy it." />
      ) : (
        <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-4xl font-bold">
              {live.average.toFixed(1)}
              <span className="text-lg font-normal text-text-muted"> / 5</span>
            </p>
            <Rating value={live.average} count={live.count} size={18} />
            <ul className="mt-3 space-y-1" aria-label="Rating breakdown">
              {breakdown.map((row) => (
                <li key={row.stars} className="flex items-center gap-2 text-sm">
                  <span className="w-12 text-text-muted">{row.stars} star</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-alt">
                    <span className="block h-full bg-accent" style={{ width: `${row.percent}%` }} />
                  </span>
                  <span className="w-8 text-end text-text-muted">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Customer reviews</h3>
              <label className="sr-only" htmlFor="review-sort">
                Sort reviews
              </label>
              <select id="review-sort" className={cx(inputClass, '!w-auto')} value={sort} onChange={(ev) => { setSort(ev.target.value as ReviewSort); setPageNo(1); }}>
                <option value="recent">Most recent</option>
                <option value="helpful">Most helpful</option>
                <option value="high">Highest rated</option>
                <option value="low">Lowest rated</option>
              </select>
            </div>
            <ul className="divide-y divide-border">
              {loaded.map((review) => (
                <li key={review.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Rating value={review.rating} size={14} />
                    <span className="font-medium">{review.title}</span>
                    {review.mine && <Badge tone="primary">Your review</Badge>}
                    {review.status === 'pending' && <Badge tone="warning">Waiting for moderation</Badge>}
                  </div>
                  <p className="mt-1 text-text">{review.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                    <span>{review.author}</span>
                    <span>{date(review.createdAt, 'd MMM y')}</span>
                    {review.verified && <Badge tone="success">Verified purchase</Badge>}
                  </p>
                  {!review.mine ? (
                    <button type="button" className="mt-1 inline-flex min-h-11 items-center rounded-md border border-border-strong px-3 text-sm hover:bg-surface-alt" aria-pressed={!!review.voted} onClick={() => void vote(review)}>
                      {review.voted ? 'Marked helpful' : 'Helpful'} ({review.helpful})<span className="sr-only"> for review “{review.title}”</span>
                    </button>
                  ) : (
                    <p className="mt-1 text-sm text-text-muted">{review.helpful} found this helpful</p>
                  )}
                </li>
              ))}
            </ul>
            {page.loading && <Skeleton className="mt-3 h-16" />}
            {hasMore && (
              <Button variant="secondary" type="button" className="mt-3" loading={page.loading} onClick={() => setPageNo((n) => n + 1)}>
                Show more reviews
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
