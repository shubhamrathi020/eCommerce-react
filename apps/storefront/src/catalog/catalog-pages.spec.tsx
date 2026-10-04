import { firstValueFrom } from 'rxjs';
import { act } from '@testing-library/react';
import { AlertApi, CatalogApi, DEMO_ACCOUNTS, MockContentStore, MockInventoryStore } from '@shop/data-access';
import { click, violations } from '@shop/ui/testing';
import { demo, open, openSignedIn } from '../test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';
const firstProductHref = (main: HTMLElement) => main.querySelector('article h3 a')?.getAttribute('href') ?? '';

describe('catalog pages', () => {
  it('home renders banners, categories and product rows', async () => {
    const page = await open('/');
    const main = page.main();
    expect(main.querySelector('section[aria-roledescription="carousel"]')).not.toBeNull();
    expect(main.querySelectorAll('section[aria-label="Shop by category"] li')).toHaveLength(8);
    expect(main.querySelectorAll('article').length).toBeGreaterThan(10);
  });

  it('category listing shows facets, filters by brand from the URL and sorts', async () => {
    const page = await open('/c/mobiles?brand=nova&sort=price-asc');
    const main = page.main();
    expect(main.querySelector('h1')?.textContent).toBe('Mobiles');
    const cards = main.querySelectorAll('article');
    expect(cards.length).toBeGreaterThan(0);
    expect(Array.from(cards).every((c) => c.textContent?.includes('Nova'))).toBe(true);
    expect(main.querySelector('[aria-label="Active filters"]')?.textContent).toContain('Brand: Nova');
    const prices = Array.from(main.querySelectorAll('article span.text-lg')).map((n) => Number((n.textContent ?? '').replace(/[^\d]/g, '')));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('mobile "load more" appends the next page instead of replacing it, and a filter change starts over', async () => {
    const page = await open('/c/fashion');
    const main = page.main();
    expect(main.querySelectorAll('article')).toHaveLength(24); // first page

    const loadMore = Array.from(main.querySelectorAll('a')).find((a) => a.textContent?.trim() === 'Load more') as HTMLAnchorElement;
    expect(loadMore.getAttribute('href')).toBe('/c/fashion?page=2'); // a real, crawlable link
    await click(loadMore);
    await page.settle(15);
    expect(main.querySelectorAll('article')).toHaveLength(37); // appended, not replaced: 36 catalog products plus the one live seller listing
    expect(text(main)).toContain("You've seen every result");

    // Changing a filter is a different listing: it replaces the list rather than keeps appending.
    await page.go('/c/fashion?page=2&brand=nova');
    expect(page.main().querySelectorAll('article').length).toBeLessThan(37);
  });

  it('unknown category shows the not-found page', async () => {
    const page = await open('/c/does-not-exist');
    expect(text(page.main())).toContain('We could not find that page');
  });

  it('product page lets the shopper switch variants and updates price, SKU and URL', async () => {
    const list = await open('/c/laptops');
    const href = firstProductHref(list.main());
    expect(href).toMatch(/^\/p\//);
    const page = await open(href);
    const main = page.main();
    expect(main.querySelector('h1')).not.toBeNull();
    const radios = Array.from(main.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter((r) => r.getAttribute('aria-checked') === 'false' && !r.disabled);
    expect(radios.length).toBeGreaterThan(0);
    const before = text(main).match(/SKU [\w-]+/)?.[0];
    await click(radios[0]);
    await page.settle(5);
    expect(text(main).match(/SKU [\w-]+/)?.[0]).not.toBe(before);
    expect(document.getElementById('seo-jsonld')?.textContent).toContain('"Product"');
  });

  it('product page shows a backorder message and still allows adding to the cart when stock is zero', async () => {
    const list = await open('/c/laptops');
    const slug = firstProductHref(list.main()).replace('/p/', '');
    const page = await open(`/p/${slug}`, async (injector) => {
      const catalog = injector.get(CatalogApi);
      const listing = await firstValueFrom(catalog.listing({ categorySlug: 'laptops', filters: {}, sort: 'featured', page: 1, pageSize: 20 }));
      const summary = listing.items.find((i) => i.slug === slug);
      const product = (await firstValueFrom(catalog.productsByIds([summary?.id ?? ''])))[0];
      const store = injector.get(MockInventoryStore);
      for (const v of product.variants) {
        if (v.stock > 0) store.adjust({ variantId: v.id, locationId: 'loc-main', kind: 'correction', quantity: -v.stock, reason: 'count_correction' }, [product], 'Test');
        store.setPolicy(v.id, { backorder: true, expectedDate: '2026-12-01' }, [product]);
      }
    });
    const main = page.main();
    expect(text(main)).toContain('Backorder');
    expect(text(main)).toContain('Ships around 1 Dec 2026');
    expect(text(main)).not.toContain('Out of stock');
    const add = Array.from(main.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Add to cart') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
  });

  it('signed-in shoppers can subscribe to a price-drop alert from the product page', async () => {
    const list = await open('/c/laptops');
    const slug = firstProductHref(list.main()).replace('/p/', '');
    const page = await openSignedIn(`/p/${slug}`);
    await page.settle(20);
    const alertButton = Array.from(page.main().querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Alert me on price drop') as HTMLButtonElement;
    expect(alertButton).toBeTruthy();
    await click(alertButton);
    await page.settle(10);
    expect(await firstValueFrom(page.injector.get(AlertApi).list())).toHaveLength(1);
    expect(demo.email).toBe(DEMO_ACCOUNTS[0].email);
  });

  it('unknown product shows the not-found page', async () => {
    const page = await open('/p/nope');
    expect(text(page.main())).toContain('We could not find that page');
  });

  // axe walks every node, and these pages have dozens of product cards, so each page gets its own test and a generous timeout.
  it('home has no serious accessibility violations', async () => {
    const page = await open('/');
    expect(await violations(page.root())).toEqual([]);
  }, 120000);

  it('a listing has no serious accessibility violations', async () => {
    const page = await open('/c/footwear');
    expect(await violations(page.root())).toEqual([]);
  }, 120000);

  it('a product page has no serious accessibility violations', async () => {
    const listing = await open('/c/footwear');
    const page = await open(firstProductHref(listing.main()));
    expect(await violations(page.root())).toEqual([]);
  }, 120000);

  it('search page: relevance sort by default, typo tolerance, corrected-query notice and zero-result help', async () => {
    const found = await open('/search?q=sneekers');
    expect(found.main().querySelector('h1')?.textContent).toContain('sneekers');
    expect(found.main().querySelectorAll('article').length).toBeGreaterThan(0);
    expect(found.main().querySelector('select')?.value).toBe('relevance');
    expect(Array.from(found.main().querySelectorAll('#sort option')).map((o) => o.textContent)).toContain('Relevance');
    expect(text(found.main())).not.toContain('No exact matches');

    const corrected = await open('/search?q=tvx');
    expect(text(corrected.main())).toContain('No exact matches for “tvx”');
    expect(corrected.main().querySelectorAll('article').length).toBeGreaterThan(0);

    const none = await open('/search?q=qzqzqz');
    expect(text(none.main())).toContain('No results for “qzqzqz”');
    expect(text(none.main())).toContain('Popular searches');
    expect(none.main().querySelectorAll('a[href^="/search?q="]').length).toBeGreaterThan(3);
    expect(await violations(none.root())).toEqual([]);
  }, 40000);

  it('category pages do not offer the relevance sort', async () => {
    const page = await open('/c/laptops');
    expect(Array.from(page.main().querySelectorAll('#sort option')).map((o) => o.textContent)).not.toContain('Relevance');
  });

  it('home page follows the content settings: banners, section order and visibility', async () => {
    const page = await open('/', async (injector) => {
      const store = injector.get(MockContentStore);
      store.setBanners(store.banners().map((b, i) => ({ ...b, active: i === 0 })));
      store.setSections(store.sections().map((s) => (s.key === 'brands' ? { ...s, enabled: false } : s.key === 'new' ? { ...s, title: 'Fresh in store', order: 0 } : s)));
    });
    const main = page.main();
    expect(main.querySelectorAll('section[aria-roledescription="carousel"] [role="group"]')).toHaveLength(1);
    expect(main.querySelector('section[aria-label="Popular brands"]')).toBeNull();
    const headings = Array.from(main.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(headings).toContain('Fresh in store');
    expect(headings.indexOf('Fresh in store')).toBeLessThan(headings.indexOf('Shop by category'));
    await act(async () => undefined);
  });
});
