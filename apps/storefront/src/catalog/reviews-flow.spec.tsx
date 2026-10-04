import { act, fireEvent } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import type { Injector } from '@shop/core';
import { CartApi, CatalogApi, OrderApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { button, click, fill, violations } from '@shop/ui/testing';
import { demo, open } from '../test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';

async function pickProduct(injector: Injector) {
  const catalog = injector.get(CatalogApi);
  const list = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 60 }));
  const product = (await firstValueFrom(catalog.productsByIds(list.items.map((i) => i.id)))).find((p) => p.variants.some((v) => v.stock > 5));
  if (!product) throw new Error('no product');
  return product;
}

async function buy(injector: Injector, productId: string) {
  const product = (await firstValueFrom(injector.get(CatalogApi).productsByIds([productId])))[0];
  await firstValueFrom(injector.get(CartApi).add((product.variants.find((v) => v.stock > 5) ?? product.variants[0]).id, 1));
  await firstValueFrom(
    injector.get(OrderApi).place({ idempotencyKey: `k${Math.random()}`, contact: { name: demo.name, email: demo.email, phone: '9876543210' }, address: { line1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001' }, paymentMethod: 'cod' }),
  );
}

type Page = Awaited<ReturnType<typeof open>>;
/** Opens a product page on its Reviews tab. */
async function openReviews(page: Page, slug: string) {
  await page.go(`/p/${slug}`);
  const tab = Array.from(page.main().querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.includes('Reviews'));
  await click(tab);
  await page.settle(15);
  return page.main();
}

/** Opens any page just to get a signed-in-or-out app and a product to work with. */
async function start(signIn: boolean) {
  let product!: Awaited<ReturnType<typeof pickProduct>>;
  const page = await open('/', async (injector) => {
    product = await pickProduct(injector);
    const auth = injector.get(AuthStore);
    await auth.init();
    if (signIn) {
      await auth.login(demo.email, demo.password);
      await buy(injector, product.id);
    }
  });
  return { page, product };
}

describe('writing and voting on reviews', () => {
  it('tells visitors why they cannot review: signed out, then not a buyer', async () => {
    const { page, product } = await start(false);
    let main = await openReviews(page, product.slug);
    expect(text(main)).toContain('to review products you have bought');
    expect(main.querySelector('form[aria-label="Review form"]')).toBeNull();

    await page.injector.get(AuthStore).login(demo.email, demo.password);
    main = await openReviews(page, product.slug);
    expect(text(main)).toContain('Only customers who bought this product can review it.');
  }, 30000);

  it('a buyer writes a review with validation, sees it live, and can edit and delete it', async () => {
    const { page, product } = await start(true);
    const main = await openReviews(page, product.slug);
    const before = product.rating.count;

    await click(button(main, 'Write a review'));
    await page.settle();
    expect(await violations(page.root())).toEqual([]);
    await click(button(main, 'Submit review'));
    await page.settle(15);
    expect(text(main)).toContain('Choose a rating from 1 to 5 stars');
    expect(text(main)).toContain('This field is required');
    await fill(main, 'Your review', 'too short');
    await click(button(main, 'Submit review'));
    await page.settle(10);
    expect(text(main)).toContain('Write at least 10 characters');

    // stars work with the keyboard: arrow right selects the next star
    const stars = () => main.querySelectorAll<HTMLElement>('[role="tabpanel"] [role="radiogroup"] [role="radio"]');
    await click(stars()[0]);
    await act(async () => {
      fireEvent.keyDown(stars()[0], { key: 'ArrowRight' });
    });
    await page.settle();
    expect(main.querySelectorAll('[role="tabpanel"] [role="radiogroup"] [role="radio"][aria-checked="true"]')).toHaveLength(1);
    expect(main.querySelector('[role="tabpanel"] [role="radiogroup"] [role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe('2 stars');
    await click(stars()[4]);
    await fill(main, 'Title', 'Really good');
    await fill(main, 'Your review', 'Solid quality and quick delivery, happy with it.');
    await click(button(main, 'Submit review'));
    await page.settle(20);

    expect(text(main)).toContain('Your review is now live');
    expect(text(main)).toContain('Your review');
    expect(text(main)).toContain('Verified purchase');
    expect(main.querySelector('h3:not(#write-h)')).not.toBeNull();
    expect(text(main)).toContain(String(before + 1));

    await click(button(main, 'Edit'));
    await page.settle(10);
    expect((Array.from(main.querySelectorAll('label')).find((l) => l.textContent?.startsWith('Title'))?.nextElementSibling as HTMLInputElement).value).toBe('Really good');
    await fill(main, 'Your review', 'Actually, see www.spam.example for a better one.');
    await click(button(main, 'Save review'));
    await page.settle(20);
    expect(text(main)).toContain('waiting for moderation');

    await click(button(main, 'Delete'));
    await page.settle(20);
    expect(text(main)).toContain('Your review was deleted.');
    expect(await violations(page.root())).toEqual([]);
  }, 60000);

  it('helpful votes need sign in, toggle for buyers of other reviews, and update the count', async () => {
    const { page, product } = await start(false);
    let main = await openReviews(page, product.slug);
    const firstVote = () => main.querySelector<HTMLButtonElement>('[role="tabpanel"] button[aria-pressed]');
    if (!firstVote()) return; // product without reviews: nothing to vote on
    await click(firstVote());
    await page.settle();
    expect(firstVote()?.getAttribute('aria-pressed')).toBe('false'); // signed out: no vote recorded

    await page.injector.get(AuthStore).login(demo.email, demo.password);
    main = await openReviews(page, product.slug);
    const first = firstVote();
    const count = Number(first?.textContent?.match(/\((\d+)\)/)?.[1]);
    await click(first);
    await page.settle(15);
    expect(firstVote()?.getAttribute('aria-pressed')).toBe('true');
    expect(Number(firstVote()?.textContent?.match(/\((\d+)\)/)?.[1])).toBe(count + 1);
    await click(firstVote());
    await page.settle(15);
    expect(firstVote()?.getAttribute('aria-pressed')).toBe('false');
  }, 40000);
});
