import type { Observable } from 'rxjs';
import type { CmsPage } from '@ecom/contracts';

export abstract class CmsApi {
  /** Emits the page, or errors with an `ApiError` (`not_found`) for an unknown slug. */
  /** Draft pages are only returned with `preview` and only to staff with `content:write`. */
  abstract page(slug: string, options?: { preview?: boolean }): Observable<CmsPage>;
}
