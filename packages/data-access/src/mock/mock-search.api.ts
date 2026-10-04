import { Injectable, inject } from '@shop/core';
import type { SearchSuggestions } from '@ecom/contracts';
import { SearchApi } from '../lib/search.api';
import { loadCatalogData } from './catalog-data';
import { sortProducts, toSummary } from './catalog-engine';
import { POPULAR_SEARCHES, buildIndex, cleanQuery, matchNames, searchProducts, suggestQueries } from './search-engine';
import { MockInventoryStore } from './inventory-store';
import { createMockResponder } from './mock-latency';

@Injectable()
export class MockSearchApi extends SearchApi {
  private readonly respond = createMockResponder();
  private readonly inventory = inject(MockInventoryStore);

  suggest(query: string) {
    return this.respond.okAsync<SearchSuggestions>(async () => {
      const q = cleanQuery(query);
      const data = await loadCatalogData();
      const { categories, brands } = data;
      const products = this.inventory.apply(data.products);
      if (!q) return { queries: POPULAR_SEARCHES.slice(0, 5), products: [], categories: [], brands: [] };
      const matches = searchProducts(buildIndex(products), products, q);
      const top = sortProducts(matches.products, 'relevance', matches.scores).slice(0, 4).map(toSummary);
      return {
        queries: suggestQueries(q, categories, brands, matches, 5),
        products: top,
        categories: matchNames(categories, q, 3).map((c) => ({ slug: c.slug, name: c.name })),
        brands: matchNames(brands, q, 3).map((b) => ({ slug: b.slug, name: b.name })),
      };
    });
  }

  popular() {
    return this.respond.okAsync(async () => [...POPULAR_SEARCHES]);
  }
}
