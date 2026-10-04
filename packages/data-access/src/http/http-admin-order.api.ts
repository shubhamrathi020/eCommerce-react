import { Injectable, inject } from '@shop/core';
import type { AdminOrderDetail, AdminOrderQuery, AdminOrderRow, OrderStatus, Paged } from '@ecom/contracts';
import type { Observable } from 'rxjs';
import { AdminOrderApi } from '../lib/admin.api';
import { ApiClient } from './api-client';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** `AdminOrderApi` against the real commerce store (BRD 21, CM21-09). Same contract as `MockAdminOrderApi`. */
@Injectable()
export class HttpAdminOrderApi extends AdminOrderApi {
  private readonly api = inject(ApiClient);

  list(query: AdminOrderQuery): Observable<Paged<AdminOrderRow>> {
    return this.api.authed('GET', `/admin/orders${qs({ q: query.q, status: query.status, paymentMethod: query.paymentMethod, from: query.from, to: query.to, page: query.page, pageSize: query.pageSize })}`);
  }

  get(id: string): Observable<AdminOrderDetail> {
    return this.api.authed('GET', `/admin/orders/${encodeURIComponent(id)}`);
  }

  advance(id: string, status: OrderStatus): Observable<AdminOrderDetail> {
    return this.api.authed('PATCH', `/admin/orders/${encodeURIComponent(id)}/status`, { status });
  }

  addNote(id: string, text: string): Observable<AdminOrderDetail> {
    return this.api.authed('POST', `/admin/orders/${encodeURIComponent(id)}/notes`, { text });
  }
}
