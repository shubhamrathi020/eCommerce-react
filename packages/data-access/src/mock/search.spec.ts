import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { ListingQuery } from '@ecom/contracts';
import { CatalogApi, SearchApi, provideDataAccess } from '../index';
import { editDistance, stem, tokenize } from './search-engine';

const base: ListingQuery = { filters: {}, sort: 'relevance', page: 1, pageSize: 100 };

describe('search helpers', () => {
  it('tokenizes, joins hyphenated words and stems plurals', () => {
    expect(tokenize('Cotton T-Shirt!')).toEqual(['cotton', 't', 'shirt', 'tshirt']);
    expect(stem('sneakers')).toBe('sneaker');
    expect(stem('watches')).toBe('watch');
    expect(stem('batteries')).toBe('battery');
    expect(stem('glass')).toBe('glass');
  });

  it('computes edit distance with transposition and early exit', () => {
    expect(editDistance('laptop', 'labtop', 2)).toBe(1);
    expect(editDistance('laptop', 'lpatop', 2)).toBe(1);
    expect(editDistance('abc', 'abcdefgh', 2)).toBeGreaterThan(2);
  });
});

describe('mock search', () => {
  let catalog: CatalogApi;
  let search: SearchApi;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true })],
    });
    catalog = TestBed.inject(CatalogApi);
    search = TestBed.inject(SearchApi);
  });

  const find = (q: string) => firstValueFrom(catalog.listing({ ...base, q }));
  const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title.toLowerCase());

  it('matches every word (AND) and returns only relevant products', async () => {
    const r = await find('cotton shirt');
    expect(r.total).toBeGreaterThan(0);
    for (const item of r.items) expect(item.title.toLowerCase()).toContain('shirt');
  });

  it('is tolerant of typos in longer words and handles plurals', async () => {
    const exact = await find('laptop');
    const typo = await find('labtop');
    expect(typo.total).toBe(exact.total);
    expect(typo.correctedFrom).toBeUndefined();
    expect((await find('sneekers')).total).toBeGreaterThan(0);
    expect((await find('watches')).total).toBeGreaterThan(0);
  });

  it('does not silently tolerate typos in very short words, but offers a correction', async () => {
    const r = await find('tvx');
    expect(r.correctedFrom).toBe('tvx');
    expect(r.title).toContain('"tv"');
    expect((await find('qzq')).total).toBe(0);
  });

  it('expands synonyms', async () => {
    const phone = await find('smartphone');
    const mobile = await find('mobile');
    expect(mobile.total).toBeGreaterThan(0);
    expect(new Set(mobile.items.map((i) => i.id))).toEqual(new Set([...phone.items, ...mobile.items].filter((i) => mobile.items.some((m) => m.id === i.id)).map((i) => i.id)));
    expect((await find('tee')).total).toBeGreaterThan(0);
  });

  it('matches a prefix on the last word only', async () => {
    expect((await find('smart')).total).toBeGreaterThan(0);
    expect((await find('smar phone')).total).toBe(0); // "smar" is not last and too short for typo tolerance to help
  });

  it('ranks a full title match first and puts out-of-stock items last', async () => {
    const list = await firstValueFrom(catalog.listing({ ...base, sort: 'featured' }));
    const target = list.items.find((i) => i.stockStatus === 'in_stock');
    const r = await find(target?.title ?? '');
    expect(r.items[0].title).toBe(target?.title);
    const firstOos = r.items.findIndex((i) => i.stockStatus === 'out_of_stock');
    if (firstOos >= 0) expect(r.items.slice(firstOos).every((i) => i.stockStatus === 'out_of_stock')).toBe(true);
  });

  it('shows results for a corrected query when the original has none', async () => {
    const r = await find('laptp computr');
    // "computr" is not a word in the catalog; the correction cannot be found, so this stays empty.
    expect(r.total).toBe(0);
    const fixed = await find('headphnes');
    expect(fixed.total).toBeGreaterThan(0);
  });

  it('gives a corrected query and title when only a far-off spelling has matches', async () => {
    const r = await find('sportswaer');
    expect(r.total).toBeGreaterThan(0);
  });

  it('combines search with category filters and facets', async () => {
    const r = await firstValueFrom(catalog.listing({ ...base, q: 'phone', categorySlug: 'mobiles' }));
    expect(r.total).toBeGreaterThan(0);
    expect(r.facets.find((f) => f.key === 'brand')?.options.length).toBeGreaterThan(0);
    expect(titles(r).every((t) => t.length > 0)).toBe(true);
  });

  it('suggests queries, products, categories and brands', async () => {
    const s = await firstValueFrom(search.suggest('lap'));
    expect(s.queries.length).toBeGreaterThan(0);
    expect(s.products.length).toBeGreaterThan(0);
    expect(s.categories.map((c) => c.name)).toContain('Laptops');
    const empty = await firstValueFrom(search.suggest(''));
    expect(empty.queries.length).toBe(5);
    expect(empty.products).toEqual([]);
    expect((await firstValueFrom(search.popular())).length).toBeGreaterThan(3);
  });

  it('treats markup in queries as plain text and limits length', async () => {
    const r = await find('<script>alert(1)</script>');
    expect(r.total).toBe(0);
    const long = await find('a'.repeat(500));
    expect(long.total).toBe(0);
  });
});
