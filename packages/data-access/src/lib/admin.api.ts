import type { Observable } from 'rxjs';
import type {
  AdminCategoryOption,
  AdminCoupon,
  AdminOrderDetail,
  AdminOrderQuery,
  AdminOrderRow,
  AdminProductDetail,
  AdminProductInput,
  AdminProductQuery,
  AdminReviewRow,
  AdminProductRow,
  AdminUser,
  AuditEntry,
  DashboardMetrics,
  OrderStatus,
  Paged,
  ProductStatus,
  Role,
} from '@ecom/contracts';

/**
 * Back-office contracts. Every method requires the matching permission on the server
 * (the mock enforces them too); write actions are recorded in the audit log.
 * Errors are `ApiException`s (`forbidden`, `validation`, `not_found`).
 */
export abstract class AdminProductApi {
  abstract list(query: AdminProductQuery): Observable<Paged<AdminProductRow>>;
  abstract get(id: string): Observable<AdminProductDetail>;
  abstract categories(): Observable<AdminCategoryOption[]>;
  abstract create(input: AdminProductInput): Observable<AdminProductDetail>;
  abstract update(id: string, input: AdminProductInput): Observable<AdminProductDetail>;
  /** Publish or archive several products at once; returns how many changed. */
  abstract bulkSetStatus(ids: string[], status: ProductStatus): Observable<number>;
  /** Deletes draft products only; returns how many were deleted. */
  abstract bulkDeleteDrafts(ids: string[]): Observable<number>;
}

export abstract class AdminOrderApi {
  abstract list(query: AdminOrderQuery): Observable<Paged<AdminOrderRow>>;
  abstract get(id: string): Observable<AdminOrderDetail>;
  abstract advance(id: string, status: OrderStatus): Observable<AdminOrderDetail>;
  abstract addNote(id: string, text: string): Observable<AdminOrderDetail>;
}

export abstract class AdminCouponApi {
  abstract list(): Observable<AdminCoupon[]>;
  /** Creates or updates by code. */
  abstract save(coupon: Omit<AdminCoupon, 'usageCount'>, isNew: boolean): Observable<AdminCoupon[]>;
  abstract setActive(code: string, active: boolean): Observable<AdminCoupon[]>;
}

export abstract class AdminUserApi {
  abstract list(): Observable<AdminUser[]>;
  abstract setRole(userId: string, role: Role, granted: boolean): Observable<AdminUser[]>;
}

export abstract class AdminReviewApi {
  abstract list(query: { status?: AdminReviewRow['status']; page: number; pageSize: number }): Observable<Paged<AdminReviewRow>>;
  abstract pendingCount(): Observable<number>;
  abstract moderate(id: string, decision: 'approved' | 'rejected'): Observable<AdminReviewRow>;
  abstract remove(id: string): Observable<void>;
}

export abstract class AdminDashboardApi {
  abstract metrics(days: number): Observable<DashboardMetrics>;
}

export abstract class AuditApi {
  abstract list(query: { q?: string; page: number; pageSize: number }): Observable<Paged<AuditEntry>>;
}
