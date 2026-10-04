import { Injectable, inject } from '@shop/core';
import type { AlertKind, AlertSubscription, AppNotification, NotificationPreferences } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { AlertApi, NotificationApi, PreferenceApi, type UnsubscribeChannel } from '../lib/notification.api';
import { loadCatalogData } from './catalog-data';
import { MockInventoryStore } from './inventory-store';
import { MockNotificationStore } from './notification-store';
import { createMockResponder } from './mock-latency';
import { MockUserStore } from './mock-user-store';

function requireUser(users: MockUserStore): string {
  const session = users.session();
  if (!session) throw new ApiException('unauthorized', 'Please sign in.');
  return session.user.id;
}

@Injectable()
export class MockPreferenceApi extends PreferenceApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockNotificationStore);
  private readonly users = inject(MockUserStore);

  get() {
    return this.respond.okAsync<NotificationPreferences>(async () => this.store.preferences(requireUser(this.users)));
  }

  save(preferences: NotificationPreferences) {
    return this.respond.okAsync<NotificationPreferences>(async () => this.store.savePreferences(requireUser(this.users), preferences));
  }

  unsubscribeLink(channel: UnsubscribeChannel) {
    return this.respond.okAsync<string>(async () => `/unsubscribe?token=${this.store.unsubscribeToken(requireUser(this.users), channel)}`);
  }

  unsubscribe(token: string) {
    return this.respond.okAsync<{ label: string }>(async () => {
      const { label } = this.store.unsubscribe(token);
      return { label };
    });
  }
}

@Injectable()
export class MockAlertApi extends AlertApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockNotificationStore);
  private readonly users = inject(MockUserStore);
  private readonly inventory = inject(MockInventoryStore);

  list() {
    return this.respond.okAsync<AlertSubscription[]>(async () => this.store.alerts(requireUser(this.users)));
  }

  subscribe(kind: AlertKind, variantId: string) {
    return this.respond.okAsync<AlertSubscription[]>(async () => {
      const userId = requireUser(this.users);
      const { products } = await loadCatalogData();
      const stocked = this.inventory.apply(products);
      const found = stocked.flatMap((p) => p.variants.map((v) => ({ p, v }))).find((x) => x.v.id === variantId);
      if (!found) throw new ApiException('not_found', 'This product is no longer available.');
      return this.store.subscribe(userId, kind, found.p, found.v);
    });
  }

  remove(id: string) {
    return this.respond.okAsync<AlertSubscription[]>(async () => this.store.removeAlert(requireUser(this.users), id));
  }
}

@Injectable()
export class MockNotificationApi extends NotificationApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockNotificationStore);
  private readonly users = inject(MockUserStore);

  list() {
    return this.respond.okAsync<AppNotification[]>(async () => this.store.notifications(requireUser(this.users)));
  }

  unreadCount() {
    return this.respond.okAsync<number>(async () => this.store.unreadCount(requireUser(this.users)));
  }

  markRead(id: string) {
    return this.respond.okAsync<void>(async () => {
      this.store.markRead(requireUser(this.users), id);
    });
  }

  markAllRead() {
    return this.respond.okAsync<void>(async () => {
      this.store.markAllRead(requireUser(this.users));
    });
  }
}
