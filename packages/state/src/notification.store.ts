import { Injectable, computed, inject, signal } from '@shop/core';
import { firstValueFrom } from 'rxjs';
import { NotificationApi } from '@shop/data-access';
import type { AppNotification } from '@ecom/contracts';

/**
 * The notification-centre bell: unread count and list for the signed-in shopper. Guests see nothing.
 * `AuthStore` calls `refresh()` after every sign-in and sign-out so the badge updates without a reload.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly api = inject(NotificationApi);
  private readonly browser = typeof window !== 'undefined';

  private readonly _notifications = signal<AppNotification[]>([]);
  private readonly _loaded = signal(false);

  readonly notifications = this._notifications.asReadonly();
  readonly unreadCount = computed(() => this._notifications().filter((n) => !n.read).length);
  readonly loaded = this._loaded.asReadonly();

  /** Re-reads the bell for the current session, or clears it for a signed-out one. Never throws. */
  async refresh(loggedIn: boolean): Promise<void> {
    if (!this.browser || !loggedIn) {
      this._notifications.set([]);
      this._loaded.set(true);
      return;
    }
    try {
      this._notifications.set(await firstValueFrom(this.api.list()));
    } catch {
      this._notifications.set([]);
    } finally {
      this._loaded.set(true);
    }
  }

  async markRead(id: string): Promise<void> {
    this._notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await firstValueFrom(this.api.markRead(id));
    } catch {
      // Best effort: the next refresh reconciles the real state.
    }
  }

  async markAllRead(): Promise<void> {
    this._notifications.update((list) => list.map((n) => ({ ...n, read: true })));
    try {
      await firstValueFrom(this.api.markAllRead());
    } catch {
      // Best effort: the next refresh reconciles the real state.
    }
  }
}
