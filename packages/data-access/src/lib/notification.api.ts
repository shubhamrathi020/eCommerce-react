import type { Observable } from 'rxjs';
import type { AlertKind, AlertSubscription, AppNotification, DeliveryLogEntry, DeliveryQuery, MessageTemplate, NotificationPreferences, Paged } from '@ecom/contracts';

export type UnsubscribeChannel = 'marketing' | 'back_in_stock' | 'price_drop';

/** What the shopper is sent and how much of it. Reads and writes need a signed-in session. */
export abstract class PreferenceApi {
  abstract get(): Observable<NotificationPreferences>;
  abstract save(preferences: NotificationPreferences): Observable<NotificationPreferences>;
  /** The same signed one-click unsubscribe link a real email would carry in its footer, for this channel. */
  abstract unsubscribeLink(channel: UnsubscribeChannel): Observable<string>;
  /** No sign-in needed: `token` is that signed link. Turns that one channel off. */
  abstract unsubscribe(token: string): Observable<{ label: string }>;
}

/** "Notify me" (back in stock) and "Alert me" (price drop) subscriptions. Needs a signed-in session. */
export abstract class AlertApi {
  abstract list(): Observable<AlertSubscription[]>;
  abstract subscribe(kind: AlertKind, variantId: string): Observable<AlertSubscription[]>;
  abstract remove(id: string): Observable<AlertSubscription[]>;
}

/** The notification-centre bell. Needs a signed-in session. */
export abstract class NotificationApi {
  /** Newest first, most recent 50. */
  abstract list(): Observable<AppNotification[]>;
  abstract unreadCount(): Observable<number>;
  abstract markRead(id: string): Observable<void>;
  abstract markAllRead(): Observable<void>;
}

/**
 * Staff-facing message templates and delivery log. Every call needs `notification:manage`;
 * template edits are versioned and audited. Errors are `ApiException`s.
 */
export abstract class AdminNotificationApi {
  abstract templates(): Observable<MessageTemplate[]>;
  abstract template(key: string): Observable<MessageTemplate>;
  /** Unknown `{{variables}}` (outside the template's fixed list) are rejected. */
  abstract saveTemplate(key: string, input: { subject: string; body: string }): Observable<MessageTemplate>;
  abstract restoreVersion(key: string, version: number): Observable<MessageTemplate>;
  /** Renders with sample data and sends to the signed-in admin's own mailbox. */
  abstract sendTest(key: string): Observable<void>;
  abstract deliveryLog(query: DeliveryQuery): Observable<Paged<DeliveryLogEntry>>;
  abstract retry(id: string): Observable<DeliveryLogEntry>;
}
