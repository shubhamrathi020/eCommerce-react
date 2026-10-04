import { Injectable, inject } from '@shop/core';
import type { AdminCategoryOption, AdminProductDetail, AdminProductInput, AdminProductQuery, AdminProductRow, Paged, ProductStatus } from '@ecom/contracts';
import { type Observable, map } from 'rxjs';
import { AdminProductApi } from '../lib/admin.api';
import { ApiClient } from './api-client';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** `AdminProductApi` against the real catalog store (BRD 20). Same contract as `MockAdminProductApi`. */
@Injectable()
export class HttpAdminProductApi extends AdminProductApi {
  private readonly api = inject(ApiClient);

  list(query: AdminProductQuery): Observable<Paged<AdminProductRow>> {
    return this.api.authed('GET', `/admin/products${qs({ q: query.q, status: query.status, sort: query.sort, dir: query.dir, page: query.page, pageSize: query.pageSize })}`);
  }

  get(id: string): Observable<AdminProductDetail> {
    return this.api.authed('GET', `/admin/products/${encodeURIComponent(id)}`);
  }

  categories(): Observable<AdminCategoryOption[]> {
    return this.api.authed('GET', '/admin/products/categories');
  }

  create(input: AdminProductInput): Observable<AdminProductDetail> {
    return this.api.authed('POST', '/admin/products', input);
  }

  update(id: string, input: AdminProductInput): Observable<AdminProductDetail> {
    return this.api.authed('PUT', `/admin/products/${encodeURIComponent(id)}`, input);
  }

  bulkSetStatus(ids: string[], status: ProductStatus): Observable<number> {
    return this.api.authed<{ count: number }>('PATCH', '/admin/products/bulk-status', { ids, status }).pipe(map((r) => r.count));
  }

  bulkDeleteDrafts(ids: string[]): Observable<number> {
    return this.api.authed<{ count: number }>('PATCH', '/admin/products/bulk-delete-drafts', { ids }).pipe(map((r) => r.count));
  }
}
