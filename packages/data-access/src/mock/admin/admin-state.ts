import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { AdminCoupon, AuditEntry, OrderNote, OrderStatus, Product, ProductStatus, Role, TimelineEntry } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { MockInventoryStore } from '../inventory-store';
import { MockUserStore } from '../mock-user-store';

const KEY = 'ecom.mock.admin.v1';
const MAX_AUDIT = 300;

export interface ProductMeta {
  status: ProductStatus;
  updatedAt: string;
}

export interface OrderOverlay {
  status?: OrderStatus;
  timeline?: TimelineEntry[];
  notes: OrderNote[];
}

/** Everything the admin mock changes on top of the seeded data. */
export interface AdminOverlay {
  editedProducts: Record<string, Product>;
  createdProducts: Product[];
  deletedProducts: string[];
  productMeta: Record<string, ProductMeta>;
  orders: Record<string, OrderOverlay>;
  coupons: Record<string, Omit<AdminCoupon, 'usageCount'>>;
  roles: Record<string, Role[]>;
  /** Moderation decisions on seeded reviews (`deleted` removes them). */
  reviewDecisions: Record<string, 'approved' | 'rejected' | 'deleted'>;
  audit: AuditEntry[];
}

const empty = (): AdminOverlay => ({ editedProducts: {}, createdProducts: [], deletedProducts: [], productMeta: {}, orders: {}, coupons: {}, roles: {}, reviewDecisions: {}, audit: [] });

/** Overlay storage, permission checks and audit logging shared by all admin mock APIs. */
@Injectable({ providedIn: 'root' })
export class MockAdminState {
  private readonly storage = inject(STORAGE);
  private readonly users = inject(MockUserStore);
  /** Stock ledger shared with the shop mocks; admin product lists show its physical counts. */
  readonly inventory = inject(MockInventoryStore);

  read(): AdminOverlay {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { ...empty(), ...(JSON.parse(raw) as Partial<AdminOverlay>) } : empty();
    } catch {
      return empty();
    }
  }

  write(overlay: AdminOverlay): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(overlay));
    } catch {
      // Storage full or blocked; changes stay in memory for this call only.
    }
  }

  /** Runs `change` on the overlay and saves it. */
  update(change: (overlay: AdminOverlay) => void): void {
    const overlay = this.read();
    change(overlay);
    this.write(overlay);
  }

  /** Server-side permission check (the browser-side guard is only a convenience). */
  require(permission: string): { id: string; name: string; email: string } {
    const session = this.users.session();
    if (!session) throw new ApiException('unauthorized', 'Please sign in.');
    if (!session.user.permissions.includes(permission)) throw new ApiException('forbidden', 'You do not have permission to do that.');
    return { id: session.user.id, name: session.user.name, email: session.user.email };
  }

  /** Appends an audit entry. Never put secrets in `detail`. */
  record(action: string, target: string, detail: string): void {
    const actor = this.users.session()?.user.name ?? 'system';
    this.update((o) => {
      o.audit = [{ id: `aud_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), actor, action, target, detail }, ...o.audit].slice(0, MAX_AUDIT);
    });
  }
}
