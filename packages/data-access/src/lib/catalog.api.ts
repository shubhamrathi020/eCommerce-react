import type { Observable } from 'rxjs';
import type { HomeData, ListingQuery, ListingResult, Product, ProductSummary, ReviewPage, ReviewQuery, Serviceability } from '@ecom/contracts';

export interface ProductLookup {
  product: Product;
  /** Set when the requested slug was an old one; the page should redirect to `product.slug`. */
  redirectedFrom?: string;
}

/** Contract for browsing the catalog. Implemented by the mock adapter now, HTTP/GraphQL later. */
export abstract class CatalogApi {
  abstract home(): Observable<HomeData>;
  /** Errors with `ApiException('not_found')` for an unknown category, brand or collection. */
  abstract listing(query: ListingQuery): Observable<ListingResult>;
  /** Errors with `ApiException('not_found')` for an unknown slug. */
  abstract product(slug: string): Observable<ProductLookup>;
  abstract productsByIds(ids: string[]): Observable<Product[]>;
  abstract summariesByIds(ids: string[]): Observable<ProductSummary[]>;
  abstract related(productId: string): Observable<ProductSummary[]>;
  abstract boughtTogether(productId: string): Observable<ProductSummary[]>;
  abstract reviews(productId: string, query: ReviewQuery): Observable<ReviewPage>;
  /** Errors with `ApiException('validation')` for a malformed pin code. */
  abstract serviceability(pincode: string): Observable<Serviceability>;
}
