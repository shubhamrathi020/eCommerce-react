import type { Observable } from 'rxjs';
import type { SearchSuggestions } from '@ecom/contracts';

/**
 * Search helpers beyond the results list. Results themselves come from `CatalogApi.listing({ q })`,
 * so the real search engine (Meilisearch) replaces the data source, not the pages.
 */
export abstract class SearchApi {
  /** Suggestions while typing. An empty query returns popular searches only. */
  abstract suggest(query: string): Observable<SearchSuggestions>;
  abstract popular(): Observable<string[]>;
}
