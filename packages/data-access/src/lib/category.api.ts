import type { Observable } from 'rxjs';
import type { CategoryNode } from '@ecom/contracts';

/** Contract for category data. Implemented by the mock adapter now, HTTP later. */
export abstract class CategoryApi {
  /** Full category tree (roots with nested children), ordered. */
  abstract tree(): Observable<CategoryNode[]>;
}
