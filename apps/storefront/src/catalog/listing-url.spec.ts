import { paramReader, isRefined, parseListingParams, toQueryParams } from './listing-url';

const convertToParamMap = (o: Record<string, string>) => paramReader(new URLSearchParams(o));

describe('listing url state', () => {
  it('parses filters, price (rupees to paise), sort and page', () => {
    const state = parseListingParams(convertToParamMap({ brand: 'nova,orbit', ram: '8 GB', price: '500-2000', sort: 'price-asc', page: '3', q: ' phone ' }));
    expect(state.filters).toEqual({ brand: ['nova', 'orbit'], ram: ['8 GB'] });
    expect(state.priceMin).toBe(50000);
    expect(state.priceMax).toBe(200000);
    expect(state.sort).toBe('price-asc');
    expect(state.page).toBe(3);
    expect(state.q).toBe('phone');
  });

  it('falls back to safe defaults for junk input', () => {
    const state = parseListingParams(convertToParamMap({ sort: 'hax', page: '-4', price: 'x-y' }));
    expect(state.sort).toBe('featured');
    expect(state.page).toBe(1);
    expect(state.priceMin).toBeUndefined();
    expect(state.filters).toEqual({});
  });

  it('supports open-ended price ranges', () => {
    expect(parseListingParams(convertToParamMap({ price: '-999' })).priceMax).toBe(99900);
    expect(parseListingParams(convertToParamMap({ price: '500-' })).priceMin).toBe(50000);
  });

  it('round-trips and omits defaults', () => {
    const state = parseListingParams(convertToParamMap({ brand: 'a', price: '1-2', sort: 'newest', page: '2' }));
    const params = toQueryParams(state);
    expect(params).toMatchObject({ brand: 'a', price: '1-2', sort: 'newest', page: '2', q: null });
    const clean = toQueryParams({ filters: {}, sort: 'featured', page: 1 });
    expect(Object.values(clean).every((v) => v === null)).toBe(true);
  });

  it('nulls previously used filter keys so the router clears them', () => {
    const params = toQueryParams({ filters: {}, sort: 'featured', page: 1 }, ['brand', 'page']);
    expect(params['brand']).toBeNull();
  });

  it('flags refined views for noindex', () => {
    expect(isRefined({ filters: {}, sort: 'featured', page: 4 })).toBe(false);
    expect(isRefined({ filters: { brand: ['a'] }, sort: 'featured', page: 1 })).toBe(true);
    expect(isRefined({ filters: {}, sort: 'rating', page: 1 })).toBe(true);
  });
});
