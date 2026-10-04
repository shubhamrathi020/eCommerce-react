import { Injectable, inject } from '@shop/core';
import type { CategoryNode, HomeData, ListingQuery, ListingResult, Product, ProductSummary, ReviewPage, ReviewQuery, SearchSuggestions, Serviceability } from '@ecom/contracts';
import type { Observable } from 'rxjs';
import { CatalogApi, type ProductLookup } from '../lib/catalog.api';
import { CategoryApi } from '../lib/category.api';
import { SearchApi } from '../lib/search.api';
import { ApiClient } from './api-client';

/** Builds a query string, dropping empty/undefined values; `filters` (an object) is JSON-encoded, matching
 * what `CatalogController.listing` on the real API expects to parse it back out of. */
function qs(params: Record<string, string | number | undefined | Record<string, string[]>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (typeof value === 'object') {
      if (Object.keys(value).length === 0) continue;
      search.set(key, JSON.stringify(value));
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** `CatalogApi` against the real backend (BRD 20). Same contract as `MockCatalogApi`, so no page changes. */
@Injectable()
export class HttpCatalogApi extends CatalogApi {
  private readonly api = inject(ApiClient);

  home(): Observable<HomeData> {
    return this.api.public('GET', '/catalog/home');
  }

  listing(query: ListingQuery): Observable<ListingResult> {
    const path = `/catalog/listing${qs({
      categorySlug: query.categorySlug,
      brandSlug: query.brandSlug,
      collectionSlug: query.collectionSlug,
      q: query.q,
      filters: query.filters,
      priceMin: query.priceMin,
      priceMax: query.priceMax,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    })}`;
    return this.api.public('GET', path);
  }

  product(slug: string): Observable<ProductLookup> {
    return this.api.public('GET', `/catalog/products/${encodeURIComponent(slug)}`);
  }

  productsByIds(ids: string[]): Observable<Product[]> {
    return this.api.public('POST', '/catalog/products/by-ids', { ids });
  }

  summariesByIds(ids: string[]): Observable<ProductSummary[]> {
    return this.api.public('POST', '/catalog/products/summaries', { ids });
  }

  related(productId: string): Observable<ProductSummary[]> {
    return this.api.public('GET', `/catalog/products/${encodeURIComponent(productId)}/related`);
  }

  boughtTogether(productId: string): Observable<ProductSummary[]> {
    return this.api.public('GET', `/catalog/products/${encodeURIComponent(productId)}/bought-together`);
  }

  reviews(productId: string, query: ReviewQuery): Observable<ReviewPage> {
    return this.api.public('GET', `/catalog/products/${encodeURIComponent(productId)}/reviews${qs({ sort: query.sort, page: query.page, pageSize: query.pageSize })}`);
  }

  serviceability(pincode: string): Observable<Serviceability> {
    return this.api.public('GET', `/catalog/serviceability/${encodeURIComponent(pincode)}`);
  }
}

/** `CategoryApi` against the real backend. */
@Injectable()
export class HttpCategoryApi extends CategoryApi {
  private readonly api = inject(ApiClient);

  tree(): Observable<CategoryNode[]> {
    return this.api.public('GET', '/catalog/categories/tree');
  }
}

/** `SearchApi` against the real backend: Meilisearch behind `/search/suggest` and `/search/popular`. */
@Injectable()
export class HttpSearchApi extends SearchApi {
  private readonly api = inject(ApiClient);

  suggest(query: string): Observable<SearchSuggestions> {
    return this.api.public('GET', `/search/suggest${qs({ q: query })}`);
  }

  popular(): Observable<string[]> {
    return this.api.public('GET', '/search/popular');
  }
}

