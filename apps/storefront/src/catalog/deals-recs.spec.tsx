import { act } from '@testing-library/react';
import { coPurchases } from '@ecom/contracts';
import { AnalyticsService, ConsentService } from '@shop/core';
import { MockContentStore, MockEventStore, loadCatalogData, seedEvents } from '@shop/data-access';
import { click, violations } from '@shop/ui/testing';
import { open } from '../test-harness';

const text = (root: HTMLElement | null | undefined) => root?.textContent ?? '';

describe('flash deals in the shop', () => {
  it('shows the live deal with a countdown and stock on the home page and on its product page only', async () => {
    const home = await open('/');
    const strip = home.main().querySelector('section[aria-labelledby="deals-h"]');
    expect(text(strip as HTMLElement)).toContain('Flash deals');
    expect(text(strip as HTMLElement)).toContain('20 left');
    expect(strip?.querySelector('[role="timer"]')).not.toBeNull();
    expect(await violations(home.root())).toEqual([]);

    const { products } = await loadCatalogData();
    const tee = products.find((p) => p.id === 'p-0001') as (typeof products)[number];
    const page = await open(`/p/${tee.slug}`);
    const banner = page.main().querySelector('section[aria-label="Flash deal"]') as HTMLElement;
    expect(text(banner)).toContain('Flash deal: signature tee');
    expect(text(banner)).toContain('20 of 20 left');
    expect(await violations(page.root())).toEqual([]);

    const other = products.find((p) => p.id === 'p-0002') as (typeof products)[number];
    expect((await open(`/p/${other.slug}`)).main().querySelector('section[aria-label="Flash deal"]')).toBeNull();
  }, 60000);

  it('shows who sells a marketplace product, with their rating and policies, and nothing for the store own products', async () => {
    const { products } = await loadCatalogData();
    const owned = products.find((p) => p.id === 'p-0010') as (typeof products)[number];
    const page = await open(`/p/${owned.slug}`);
    const card = page.main().querySelector('section[aria-label="Seller"]') as HTMLElement;
    expect(text(card)).toContain('Sold by Urban Threads');
    expect(text(card)).toMatch(/seller rating from \d+ reviews/);
    expect(text(card)).toContain('Returns: 7-day returns');
    expect(text(card)).not.toMatch(/GSTIN|PAN|bank/i);
    expect(await violations(page.root())).toEqual([]);

    const live = await open('/p/handloom-cotton-kurta-sp-0001');
    expect(text(live.main().querySelector('section[aria-label="Seller"]') as HTMLElement)).toContain('Sold by Urban Threads'); // a new listing shows its seller's rating

    const own = products.find((p) => p.id === 'p-0002') as (typeof products)[number];
    expect((await open(`/p/${own.slug}`)).main().querySelector('section[aria-label="Seller"]')).toBeNull();
  }, 60000);
});

describe('recommendations in the shop', () => {
  it('home shows popular rows for a new visitor, each saying why, plus a link to the privacy choices', async () => {
    const home = await open('/');
    await home.settle(25);
    const main = home.main();
    const popular = main.querySelector('section[data-strategy="personalised"]') as HTMLElement;
    expect(popular?.getAttribute('aria-label')).toBe('Popular right now');
    expect(text(popular)).toContain('Popular with shoppers right now');
    expect(text(main.querySelector('section[data-strategy="trending"]') as HTMLElement)).toMatch(/views and \d+ adds this week/);
    expect(text(main.querySelector('section[data-strategy="best_sellers"]') as HTMLElement)).toMatch(/\d+ sold this month/);
    expect(main.querySelector('a[href="/personalisation"]')).not.toBeNull();
    expect(await violations(home.root())).toEqual([]);
  }, 60000);

  it('home personalises after the shopper views products with analytics accepted', async () => {
    const { products } = await loadCatalogData();
    const cookware = products.filter((p) => p.categoryId === 'cat-cookware').slice(0, 4);
    const home = await open('/', async (injector) => {
      injector.get(ConsentService).set('all');
      const analytics = injector.get(AnalyticsService);
      for (const p of cookware) {
        analytics.track({ name: 'product_view', props: { productId: p.id } });
        analytics.track({ name: 'add_to_cart', props: { productId: p.id, quantity: 1 } });
      }
    });
    await home.settle(25);
    const mine = home.main().querySelector('section[data-strategy="personalised"]') as HTMLElement;
    expect(mine?.getAttribute('aria-label')).toBe('Recommended for you');
    expect(text(mine)).toContain('Because you looked at');
  });

  it('product page shows similar and bought-together rows without the product itself', async () => {
    const { products } = await loadCatalogData();
    const demo = seedEvents(products, Date.now());
    const purchased = [...new Set(demo.filter((e) => e.name === 'purchase').map((e) => e.props?.['productId'] as string))];
    const bestId = purchased.map((id) => ({ id, top: Math.max(0, ...coPurchases(demo, id).values()) })).sort((a, b) => b.top - a.top || a.id.localeCompare(b.id))[0].id;
    const product = products.find((p) => p.id === bestId) as (typeof products)[number];
    const page = await open(`/p/${product.slug}`);
    await page.settle(25);
    const main = page.main();
    expect(main.querySelector('section[data-strategy="similar"]')).not.toBeNull();
    expect(text(main.querySelector('section[data-strategy="bought_together"]') as HTMLElement)).toMatch(/Bought together in \d+ orders/);
    for (const link of Array.from(main.querySelectorAll<HTMLAnchorElement>('section[data-strategy] a[href^="/p/"]'))) expect(link.getAttribute('href')).not.toBe(`/p/${product.slug}`);
    expect(await violations(page.root())).toEqual([]);
  }, 60000);

  it('viewing a product records an event only with consent', async () => {
    const { products } = await loadCatalogData();
    const p = products[3];
    const without = await open(`/p/${p.slug}`);
    expect(without.injector.get(MockEventStore).recorded()).toEqual([]);
    const withConsent = await open(`/p/${p.slug}`, async (injector) => injector.get(ConsentService).set('all'));
    expect(withConsent.injector.get(MockEventStore).recorded().map((e) => e.name)).toEqual(['product_view']);
  });

  it('counts a click on a search result toward that search term, and ignores other links', async () => {
    const page = await open('/search?q=shirt', async (injector) => injector.get(ConsentService).set('all'));
    const events = () => page.injector.get(MockEventStore).recorded();
    const names = () => events().map((e) => e.name);
    expect(names()).toContain('search');
    await click(page.root().querySelector<HTMLAnchorElement>('header a[href="/wishlist"]')); // a header link, not a result
    expect(names()).not.toContain('search_result_click');
    await click(page.main().querySelector<HTMLAnchorElement>('[data-results] a[href^="/p/"]'));
    expect(events().find((e) => e.name === 'search_result_click')?.props).toEqual({ term: 'shirt' });
    await act(async () => undefined);
  });
});

describe('content on the storefront', () => {
  const page = (over: Record<string, unknown>) => ({ slug: 'shipping', title: 'Shipping', source: 'Hi', body: '<p>Hi <b>there</b></p>', status: 'published' as const, updatedAt: '2026-09-01T00:00:00Z', locked: false, ...over });

  it('footer shows the managed links, internal and external', async () => {
    const p = await open('/pages/about', async (injector) => {
      injector.get(MockContentStore).setLinks([
        { id: '1', label: 'Shipping info', href: '/pages/shipping', group: 'help', order: 1 },
        { id: '2', label: 'Our blog', href: 'https://blog.example.com', group: 'about', order: 1 },
      ]);
    });
    const footer = p.root().querySelector('footer') as HTMLElement;
    expect(text(footer)).toContain('Shipping info');
    expect(footer.querySelector('a[href="/pages/shipping"]')).not.toBeNull();
    expect(footer.querySelector('a[href="https://blog.example.com"]')?.getAttribute('rel')).toContain('noopener');
    expect(text(footer)).not.toContain('Privacy policy');
  });

  it('published pages render, drafts are a 404 for shoppers', async () => {
    const published = await open('/pages/shipping', async (injector) => injector.get(MockContentStore).savePage(page({})));
    expect(text(published.main())).toContain('there');
    const draft = await open('/pages/shipping', async (injector) => injector.get(MockContentStore).savePage(page({ status: 'draft' })));
    expect(text(draft.main())).toContain('We could not find that page');
    const preview = await open('/pages/shipping?preview=1', async (injector) => injector.get(MockContentStore).savePage(page({ status: 'draft' })));
    expect(text(preview.main())).toContain('We could not find that page'); // not signed in as staff
  });

  it('managed redirects send visitors to the new address; unknown addresses show the 404 page', async () => {
    const moved = await open('/old-shoes', async (injector) => {
      injector.get(MockContentStore).setRedirects([{ id: 'r', from: '/old-shoes', to: '/pages/about', createdAt: '2026-09-01T00:00:00Z' }]);
    });
    await moved.settle(20);
    expect(moved.url()).toBe('/pages/about');
    const missing = await open('/nothing-here');
    expect(missing.url()).toBe('/nothing-here');
    expect(text(missing.main())).toContain('We could not find that page');
  });
});

describe('personalisation page', () => {
  it('lets a guest see their activity, opt out, and clear their history', async () => {
    const p = await open('/personalisation', async (injector) => {
      injector.get(ConsentService).set('all');
      const analytics = injector.get(AnalyticsService);
      analytics.track({ name: 'product_view', props: { productId: 'p-0001' } });
      analytics.track({ name: 'product_view', props: { productId: 'p-0002' } });
    });
    await p.settle(10);
    let main = p.main();
    expect(text(main)).toContain('2 event(s) recorded for this browser');
    expect(await violations(p.root())).toEqual([]);

    await click(main.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await p.settle();
    expect(text(main)).toContain('Opted out');
    p.injector.get(AnalyticsService).track({ name: 'product_view', props: { productId: 'p-0003' } });
    expect(p.injector.get(MockEventStore).recorded()).toHaveLength(2); // nothing new was recorded

    await click(Array.from(main.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Clear my history'));
    await p.settle(12);
    main = p.main();
    expect(text(main)).toContain('0 event(s) recorded');
    expect(p.injector.get(MockEventStore).recorded()).toEqual([]);
  });
});
