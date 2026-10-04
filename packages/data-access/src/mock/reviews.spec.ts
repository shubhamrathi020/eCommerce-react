import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { AuthApi, CartApi, CatalogApi, DEMO_ACCOUNTS, OrderApi, ReviewApi, provideDataAccess, reviewFlag } from '../index';
import { mergeRating } from './mock-review-store';

const demo = DEMO_ACCOUNTS[0];
const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const good = { rating: 5, title: 'Great buy', body: 'Works exactly as described and arrived quickly.' };
const query = { sort: 'recent' as const, page: 1, pageSize: 50 };

describe('reviews (mock)', () => {
  let auth: AuthApi;
  let reviews: ReviewApi;
  let catalog: CatalogApi;
  let productId: string;

  /** Signs in the demo customer and buys the product with cash on delivery. */
  async function buy() {
    const cart = TestBed.inject(CartApi);
    const product = (await firstValueFrom(catalog.productsByIds([productId])))[0];
    await firstValueFrom(cart.add((product.variants.find((v) => v.stock > 5) ?? product.variants[0]).id, 1));
    await firstValueFrom(TestBed.inject(OrderApi).place({ idempotencyKey: `k-${Math.random()}`, contact: { name: demo.name, email: demo.email, phone: '9876543210' }, address, paymentMethod: 'cod' }));
  }

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    reviews = TestBed.inject(ReviewApi);
    catalog = TestBed.inject(CatalogApi);
    const list = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 60 }));
    const products = await firstValueFrom(catalog.productsByIds(list.items.map((i) => i.id)));
    productId = (products.find((p) => p.variants.some((v) => v.stock > 5)) ?? products[0]).id;
  });

  it('checks text: links and blocked words are flagged, clean text is not', () => {
    expect(reviewFlag('Nice', 'Visit www.example.com for deals')).toBe('Contains a link');
    expect(reviewFlag('Total SCAM', 'Do not buy this product')).toBe('Contains blocked language');
    expect(reviewFlag('Lovely', 'Very happy with the quality')).toBeNull();
  });

  it('merges new ratings into a summary', () => {
    const merged = mergeRating({ average: 4, count: 2, distribution: [0, 0, 0, 2, 0] }, [{ rating: 1 } as never, { rating: 5 } as never]);
    expect(merged.count).toBe(4);
    expect(merged.average).toBe(3.5);
    expect(merged.distribution).toEqual([1, 0, 0, 2, 1]);
  });

  it('asks signed-out visitors to sign in and non-buyers to buy first', async () => {
    expect(await firstValueFrom(reviews.eligibility(productId))).toEqual({ canReview: false, reason: 'sign_in' });
    await expect(firstValueFrom(reviews.submit({ productId, ...good }))).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(demo.email, demo.password));
    expect(await firstValueFrom(reviews.eligibility(productId))).toEqual({ canReview: false, reason: 'not_purchased' });
    await expect(firstValueFrom(reviews.submit({ productId, ...good }))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a buyer review once: validation, live review, updated ratings, no duplicates', async () => {
    await firstValueFrom(auth.login(demo.email, demo.password));
    await buy();
    expect((await firstValueFrom(reviews.eligibility(productId))).canReview).toBe(true);
    await expect(firstValueFrom(reviews.submit({ productId, rating: 9, title: '', body: 'short' }))).rejects.toMatchObject({ fields: { rating: expect.any(String), title: expect.any(String), body: expect.any(String) } });

    const before = (await firstValueFrom(catalog.reviews(productId, query))).summary;
    const created = await firstValueFrom(reviews.submit({ productId, ...good }));
    expect(created).toMatchObject({ status: 'approved', verified: true, mine: true, author: 'Demo C.' });
    expect(JSON.stringify(created)).not.toContain('userId');

    const after = await firstValueFrom(catalog.reviews(productId, query));
    expect(after.summary.count).toBe(before.count + 1);
    expect(after.items.some((r) => r.id === created.id)).toBe(true);
    const product = (await firstValueFrom(catalog.productsByIds([productId])))[0];
    expect(product.rating.count).toBe(before.count + 1);

    await expect(firstValueFrom(reviews.submit({ productId, ...good }))).rejects.toMatchObject({ message: 'You have already reviewed this product.' });
    expect((await firstValueFrom(reviews.eligibility(productId))).existing?.id).toBe(created.id);
  });

  it('holds flagged reviews for moderation: visible to the author only, not counted', async () => {
    await firstValueFrom(auth.login(demo.email, demo.password));
    await buy();
    const before = (await firstValueFrom(catalog.reviews(productId, query))).summary;
    const held = await firstValueFrom(reviews.submit({ productId, rating: 1, title: 'Bad', body: 'This is a scam, see http://spam.example' }));
    expect(held.status).toBe('pending');
    const mine = await firstValueFrom(catalog.reviews(productId, query));
    expect(mine.items.find((r) => r.id === held.id)?.status).toBe('pending');
    expect(mine.summary.count).toBe(before.count);
    await firstValueFrom(auth.logout());
    expect((await firstValueFrom(catalog.reviews(productId, query))).items.some((r) => r.id === held.id)).toBe(false);
  });

  it('edits (re-checked) and deletes own reviews, restoring the ratings', async () => {
    await firstValueFrom(auth.login(demo.email, demo.password));
    await buy();
    const before = (await firstValueFrom(catalog.reviews(productId, query))).summary;
    const created = await firstValueFrom(reviews.submit({ productId, ...good }));
    const edited = await firstValueFrom(reviews.updateMine(created.id, { rating: 3, title: 'Okay', body: 'Fine for the price after a month of use.' }));
    expect(edited).toMatchObject({ rating: 3, status: 'approved' });
    const flagged = await firstValueFrom(reviews.updateMine(created.id, { rating: 3, title: 'Okay', body: 'Buy elsewhere: www.other.example' }));
    expect(flagged.status).toBe('pending');
    await firstValueFrom(reviews.removeMine(created.id));
    expect((await firstValueFrom(catalog.reviews(productId, query))).summary.count).toBe(before.count);
    await expect(firstValueFrom(reviews.removeMine(created.id))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('helpful votes: toggle, one per user, not on your own review, needs sign in', async () => {
    const seeded = (await firstValueFrom(catalog.reviews(productId, query))).items.find((r) => r.helpful >= 0);
    await expect(firstValueFrom(reviews.vote(seeded?.id ?? 'x'))).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(demo.email, demo.password));
    const base = seeded?.helpful ?? 0;
    expect(await firstValueFrom(reviews.vote(seeded?.id ?? 'x'))).toEqual({ voted: true, helpful: 1 });
    expect((await firstValueFrom(catalog.reviews(productId, query))).items.find((r) => r.id === seeded?.id)).toMatchObject({ helpful: base + 1, voted: true });
    expect(await firstValueFrom(reviews.vote(seeded?.id ?? 'x'))).toEqual({ voted: false, helpful: 0 });

    await buy();
    const own = await firstValueFrom(reviews.submit({ productId, ...good }));
    await expect(firstValueFrom(reviews.vote(own.id))).rejects.toMatchObject({ code: 'validation' });
  });
});
