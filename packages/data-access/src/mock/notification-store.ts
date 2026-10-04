import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { AlertKind, AlertSubscription, AppNotification, DeliveryLogEntry, MessageTemplate, MessageTemplateVersion, NotificationKind, NotificationPreferences, Product, Variant } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { formatMoney } from '@shop/core';
import { MockMailbox } from './mock-mailbox';
import { MockUserStore } from './mock-user-store';

const KEY = 'ecom.mock.notifications.v1';
const MAX_PER_USER = 50;
const MAX_LOG = 300;

export const DEFAULT_PREFERENCES: NotificationPreferences = { marketing: false, priceDropAlerts: true, backInStockAlerts: true };

/** Which preference (and, for the alert kinds, subscription list) an unsubscribe link switches off. */
export type UnsubscribeChannel = 'marketing' | AlertKind;

interface NotificationState {
  /** Every user's bell entries in one array, newest first; filtered by `userId` when read. */
  notifications: (AppNotification & { userId: string })[];
  preferences: Record<string, NotificationPreferences>;
  alerts: (AlertSubscription & { userId: string })[];
  templates: Record<string, MessageTemplate>;
  deliveryLog: DeliveryLogEntry[];
}

// ---------- template seed ----------

const now = () => new Date().toISOString();
const seedVersion = (t: Omit<MessageTemplateVersion, 'updatedAt' | 'updatedBy'>): MessageTemplateVersion => ({ ...t, updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'system' });

function seedTemplate(key: string, name: string, description: string, kind: NotificationKind, variables: readonly string[], subject: string, body: string): MessageTemplate {
  return { key, name, description, kind, variables, subject, body, version: 1, updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'system', history: [seedVersion({ version: 1, subject, body })] };
}

const SEED_TEMPLATES: MessageTemplate[] = [
  seedTemplate('order_placed', 'Order placed', 'Sent when a cash-on-delivery order is confirmed.', 'order', ['name', 'orderId', 'total'], 'Order {{orderId}} confirmed', 'Hi {{name}}, thanks for your order. {{orderId}} is confirmed for {{total}}, to be paid on delivery.'),
  seedTemplate('order_paid', 'Payment received', 'Sent when an online payment is verified.', 'order', ['name', 'orderId'], 'Order {{orderId}} confirmed', "Hi {{name}}, we've received your payment and order {{orderId}} is confirmed."),
  seedTemplate('order_packed', 'Order packed', 'Sent when staff mark an order as packed.', 'order', ['name', 'orderId'], 'Order {{orderId}} is packed', 'Hi {{name}}, your order {{orderId}} has been packed and will ship soon.'),
  seedTemplate('order_shipped', 'Order shipped', 'Sent when staff mark an order as shipped.', 'order', ['name', 'orderId'], 'Order {{orderId}} has shipped', 'Hi {{name}}, your order {{orderId}} is on its way.'),
  seedTemplate('order_delivered', 'Order delivered', 'Sent when staff mark an order as delivered.', 'order', ['name', 'orderId'], 'Order {{orderId}} delivered', 'Hi {{name}}, your order {{orderId}} was delivered. We hope you love it.'),
  seedTemplate('order_cancelled', 'Order cancelled', 'Sent when an order is cancelled.', 'order', ['name', 'orderId'], 'Order {{orderId}} cancelled', 'Hi {{name}}, your order {{orderId}} has been cancelled.'),
  seedTemplate('review_status', 'Review status', 'Sent after a shopper submits or edits a review.', 'review', ['name', 'title', 'status'], 'About your review "{{title}}"', 'Hi {{name}}, your review "{{title}}" {{status}}.'),
  seedTemplate('back_in_stock', 'Back in stock', 'Sent once when a subscribed item is available again.', 'back_in_stock', ['name', 'product', 'link'], '{{product}} is back in stock', "Hi {{name}}, good news: {{product}} is back in stock. Grab it before it's gone: {{link}}"),
  seedTemplate('price_drop', 'Price drop', 'Sent when a subscribed item drops below the watched price.', 'price_drop', ['name', 'product', 'price', 'link'], '{{product}} just dropped to {{price}}', 'Hi {{name}}, the price of {{product}} dropped to {{price}}. See it here: {{link}}'),
  seedTemplate('return_requested', 'Return requested', 'Sent when a customer asks to return items.', 'order', ['name', 'returnId', 'orderId'], 'Return {{returnId}} received', 'Hi {{name}}, we have your return request {{returnId}} for order {{orderId}}. We will review it shortly.'),
  seedTemplate('return_approved', 'Return approved', 'Sent when staff approve a return and schedule the pickup.', 'order', ['name', 'returnId', 'pickupDate'], 'Return {{returnId}} approved', 'Hi {{name}}, your return {{returnId}} is approved. A courier will collect the items on {{pickupDate}}.'),
  seedTemplate('return_rejected', 'Return not accepted', 'Sent when a return is rejected, at review or at the quality check.', 'order', ['name', 'returnId', 'reason'], 'Return {{returnId}} was not accepted', 'Hi {{name}}, we could not accept return {{returnId}}. Reason: {{reason}}'),
  seedTemplate('refund_issued', 'Refund issued', 'Sent when a refund is paid out.', 'order', ['name', 'returnId', 'amount', 'method'], 'Refund of {{amount}} issued', 'Hi {{name}}, we have refunded {{amount}} for {{returnId}} ({{method}}).'),
  seedTemplate('support_reply', 'Support reply', 'Sent when staff reply to a support ticket.', 'support', ['name', 'ticketId', 'subject'], 'New reply on {{ticketId}}', 'Hi {{name}}, our team replied to your question "{{subject}}". Open the ticket to read it.'),
  seedTemplate('seller_decision', 'Seller application decision', 'Sent when an application to sell is approved or rejected.', 'account', ['name', 'store', 'outcome', 'reason'], 'Your seller application: {{outcome}}', 'Hi {{name}}, your application for {{store}} was {{outcome}}. {{reason}}'),
  seedTemplate('seller_product_decision', 'Seller listing decision', 'Sent when a seller listing is approved or rejected.', 'account', ['name', 'product', 'outcome', 'reason'], 'Your listing "{{product}}": {{outcome}}', 'Hi {{name}}, your listing "{{product}}" was {{outcome}}. {{reason}}'),
  seedTemplate('shipment_update', 'Shipment update', 'Sent when a seller moves their part of an order along.', 'order', ['name', 'orderId', 'seller', 'status'], 'Part of order {{orderId}} is {{status}}', 'Hi {{name}}, the items from {{seller}} in your order {{orderId}} are now {{status}}.'),
];

/** A couple of seeded delivery-log rows (one failed) so the admin screen has something to demo immediately. */
function seedDeliveryLog(): DeliveryLogEntry[] {
  const day = 86_400_000;
  return [
    { id: 'dl_seed_1', templateKey: 'order_shipped', to: 'aarav.sharma@example.com', subject: 'Order ORD-DEMO003 has shipped', status: 'sent', at: new Date(Date.now() - 2 * day).toISOString(), attempts: 1 },
    { id: 'dl_seed_2', templateKey: 'back_in_stock', to: 'diya.menon@example.com', subject: 'Item back in stock', status: 'failed', reason: 'Mailbox rejected: unknown recipient domain', at: new Date(Date.now() - day).toISOString(), attempts: 1 },
    { id: 'dl_seed_3', templateKey: 'order_delivered', to: 'rohan.k@example.com', subject: 'Order ORD-DEMO007 delivered', status: 'sent', at: new Date(Date.now() - day / 2).toISOString(), attempts: 1 },
  ];
}

const emptyState = (): NotificationState => ({ notifications: [], preferences: {}, alerts: [], templates: Object.fromEntries(SEED_TEMPLATES.map((t) => [t.key, t])), deliveryLog: seedDeliveryLog() });

const VARIABLE = /\{\{(\w+)\}\}/g;

/** Signs `userId:channel` with a short checksum, the mock's stand-in for a real HMAC-signed link. */
function sign(payload: string): string {
  let h = 0;
  for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toBase64Url(text: string): string {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string | null {
  try {
    return decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/'))));
  } catch {
    return null;
  }
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Device-local notifications for the mock adapters: the bell, preferences, alert subscriptions,
 * editable message templates and the delivery log. One JSON blob keyed by `ecom.mock.notifications.v1`.
 */
@Injectable({ providedIn: 'root' })
export class MockNotificationStore {
  private readonly storage = inject(STORAGE);
  private readonly mailbox = inject(MockMailbox);
  private readonly users = inject(MockUserStore);

  private read(): NotificationState {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return emptyState();
      const saved = { ...emptyState(), ...(JSON.parse(raw) as Partial<NotificationState>) };
      // Templates added by later features appear for people whose browser already holds an older saved set.
      for (const t of SEED_TEMPLATES) saved.templates[t.key] ??= t;
      return saved;
    } catch {
      return emptyState();
    }
  }

  private write(state: NotificationState): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked; the change stays in memory for this call only.
    }
  }

  private transact<T>(change: (state: NotificationState) => T): T {
    const state = this.read();
    const result = change(state);
    this.write(state);
    return result;
  }

  // ---------- bell ----------

  notifications(userId: string): AppNotification[] {
    return this.read()
      .notifications.filter((n) => n.userId === userId)
      .map(({ userId: _u, ...rest }) => rest);
  }

  unreadCount(userId: string): number {
    return this.read().notifications.filter((n) => n.userId === userId && !n.read).length;
  }

  markRead(userId: string, id: string): void {
    this.transact((s) => {
      s.notifications = s.notifications.map((n) => (n.userId === userId && n.id === id ? { ...n, read: true } : n));
    });
  }

  markAllRead(userId: string): void {
    this.transact((s) => {
      s.notifications = s.notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n));
    });
  }

  private push(state: NotificationState, userId: string, kind: NotificationKind, title: string, body: string, link?: string): void {
    const mine = state.notifications.filter((n) => n.userId === userId);
    const entry: AppNotification & { userId: string } = { id: newId('ntf'), kind, title, body, ...(link ? { link } : {}), createdAt: now(), read: false, userId };
    const rest = state.notifications.filter((n) => n.userId !== userId);
    state.notifications = [...rest, ...[entry, ...mine].slice(0, MAX_PER_USER)];
  }

  /** In-app only, no email: a lightweight nudge (e.g. "complete your payment"). */
  notify(userId: string, kind: NotificationKind, title: string, body: string, link?: string): void {
    this.transact((s) => this.push(s, userId, kind, title, body, link));
  }

  // ---------- preferences ----------

  preferences(userId: string): NotificationPreferences {
    return { ...DEFAULT_PREFERENCES, ...this.read().preferences[userId] };
  }

  savePreferences(userId: string, input: NotificationPreferences): NotificationPreferences {
    return this.transact((s) => {
      const before = { ...DEFAULT_PREFERENCES, ...s.preferences[userId] };
      const next: NotificationPreferences = { marketing: input.marketing, priceDropAlerts: input.priceDropAlerts, backInStockAlerts: input.backInStockAlerts };
      if (next.marketing && !before.marketing) next.marketingConsentAt = now();
      else if (next.marketing) next.marketingConsentAt = before.marketingConsentAt;
      s.preferences[userId] = next;
      // Turning an alert preference off also drops the shopper's subscriptions of that kind.
      if (!next.backInStockAlerts) s.alerts = s.alerts.filter((a) => !(a.userId === userId && a.kind === 'back_in_stock'));
      if (!next.priceDropAlerts) s.alerts = s.alerts.filter((a) => !(a.userId === userId && a.kind === 'price_drop'));
      return next;
    });
  }

  unsubscribeToken(userId: string, channel: UnsubscribeChannel): string {
    const payload = `${userId}:${channel}`;
    return `${toBase64Url(payload)}.${sign(payload)}`;
  }

  /** No sign-in needed; verifies the token itself. Returns what was turned off, for the confirmation page. */
  unsubscribe(token: string): { label: string; channel: UnsubscribeChannel } {
    const [b64, sig] = token.split('.');
    const payload = b64 ? fromBase64Url(b64) : null;
    if (!payload || !sig || sign(payload) !== sig) throw new ApiException('validation', 'This unsubscribe link is invalid or has expired.');
    const [userId, channel] = payload.split(':') as [string, UnsubscribeChannel];
    if (!userId || !['marketing', 'back_in_stock', 'price_drop'].includes(channel)) throw new ApiException('validation', 'This unsubscribe link is invalid or has expired.');
    const label = channel === 'marketing' ? 'marketing emails' : channel === 'back_in_stock' ? 'back-in-stock alerts' : 'price-drop alerts';
    this.transact((s) => {
      const before = { ...DEFAULT_PREFERENCES, ...s.preferences[userId] };
      if (channel === 'marketing') s.preferences[userId] = { ...before, marketing: false };
      else {
        s.preferences[userId] = { ...before, ...(channel === 'back_in_stock' ? { backInStockAlerts: false } : { priceDropAlerts: false }) };
        s.alerts = s.alerts.filter((a) => !(a.userId === userId && a.kind === channel));
      }
    });
    return { label, channel };
  }

  // ---------- alert subscriptions ----------

  alerts(userId: string): AlertSubscription[] {
    return this.read()
      .alerts.filter((a) => a.userId === userId)
      .map(({ userId: _u, ...rest }) => rest);
  }

  subscribe(userId: string, kind: AlertKind, product: Product, variant: Variant): AlertSubscription[] {
    return this.transact((s) => {
      const prefs = { ...DEFAULT_PREFERENCES, ...s.preferences[userId] };
      if (kind === 'back_in_stock' && !prefs.backInStockAlerts) throw new ApiException('validation', 'Turn on back-in-stock alerts in your notification preferences first.');
      if (kind === 'price_drop' && !prefs.priceDropAlerts) throw new ApiException('validation', 'Turn on price-drop alerts in your notification preferences first.');
      if (kind === 'back_in_stock' && variant.stock > 0) throw new ApiException('validation', 'This item is already in stock.');
      if (!s.alerts.some((a) => a.userId === userId && a.kind === kind && a.variantId === variant.id)) {
        const sub: AlertSubscription & { userId: string } = {
          id: newId('alt'),
          kind,
          productId: product.id,
          variantId: variant.id,
          slug: product.slug,
          title: product.title,
          image: variant.images?.[0] ?? product.images[0],
          createdAt: now(),
          ...(kind === 'price_drop' ? { watchPrice: variant.price.amount } : {}),
          userId,
        };
        s.alerts = [sub, ...s.alerts];
      }
      return this.alertsOf(s, userId);
    });
  }

  removeAlert(userId: string, id: string): AlertSubscription[] {
    return this.transact((s) => {
      s.alerts = s.alerts.filter((a) => !(a.userId === userId && a.id === id));
      return this.alertsOf(s, userId);
    });
  }

  private alertsOf(s: NotificationState, userId: string): AlertSubscription[] {
    return s.alerts.filter((a) => a.userId === userId).map(({ userId: _u, ...rest }) => rest);
  }

  /**
   * Checked whenever the shop reads the catalog (home, listing or product page) — the polling this
   * mock uses in place of a live back-in-stock or price-drop feed from the backend.
   */
  checkAlerts(products: Product[]): void {
    const byVariant = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)));
    this.transact((s) => {
      if (s.alerts.length === 0) return;
      const remaining: typeof s.alerts = [];
      for (const a of s.alerts) {
        const found = byVariant.get(a.variantId);
        const link = `/p/${a.slug}`;
        if (found && a.kind === 'back_in_stock' && found.v.stock > 0) {
          this.deliverInternal(s, 'back_in_stock', this.emailOf(a.userId), { name: this.nameOf(a.userId), product: found.p.title, link }, { userId: a.userId, link });
          continue; // fires once, then the subscription is used up
        }
        if (found && a.kind === 'price_drop' && a.watchPrice !== undefined && found.v.price.amount < a.watchPrice) {
          this.deliverInternal(s, 'price_drop', this.emailOf(a.userId), { name: this.nameOf(a.userId), product: found.p.title, price: formatMoney(found.v.price), link }, { userId: a.userId, link });
          remaining.push({ ...a, watchPrice: found.v.price.amount });
          continue;
        }
        remaining.push(a);
      }
      s.alerts = remaining;
    });
  }

  private emailOf(userId: string): string {
    return this.users.users().find((u) => u.id === userId)?.email ?? '';
  }

  private nameOf(userId: string): string {
    return this.users.users().find((u) => u.id === userId)?.name ?? 'there';
  }

  // ---------- templates ----------

  templates(): MessageTemplate[] {
    return Object.values(this.read().templates).sort((a, b) => a.name.localeCompare(b.name));
  }

  template(key: string): MessageTemplate {
    const t = this.read().templates[key];
    if (!t) throw new ApiException('not_found', 'Template not found');
    return t;
  }

  saveTemplate(key: string, input: { subject: string; body: string }, actor: string): MessageTemplate {
    return this.transact((s) => {
      const current = s.templates[key];
      if (!current) throw new ApiException('not_found', 'Template not found');
      const fields: Record<string, string> = {};
      if (!input.subject.trim()) fields['subject'] = 'Subject is required';
      if (!input.body.trim()) fields['body'] = 'Message body is required';
      const used = new Set([...`${input.subject} ${input.body}`.matchAll(VARIABLE)].map((m) => m[1]));
      const unknown = [...used].filter((v) => !current.variables.includes(v));
      if (unknown.length) fields['body'] = `Unknown variable(s): ${unknown.map((v) => `{{${v}}}`).join(', ')}`;
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const version = current.version + 1;
      const updated: MessageTemplate = { ...current, subject: input.subject.trim(), body: input.body.trim(), version, updatedAt: now(), updatedBy: actor, history: [{ version, subject: input.subject.trim(), body: input.body.trim(), updatedAt: now(), updatedBy: actor }, ...current.history].slice(0, 20) };
      s.templates[key] = updated;
      return updated;
    });
  }

  restoreVersion(key: string, version: number, actor: string): MessageTemplate {
    const current = this.template(key);
    const found = current.history.find((h) => h.version === version);
    if (!found) throw new ApiException('not_found', 'That version was not found.');
    return this.saveTemplate(key, { subject: found.subject, body: found.body }, actor);
  }

  /** Fills `{{variables}}`; anything left unfilled is left as-is (should not happen — callers pass every variable). */
  private render(template: MessageTemplate, vars: Record<string, string>): { subject: string; body: string } {
    const fill = (text: string) => text.replace(VARIABLE, (m, name: string) => vars[name] ?? m);
    return { subject: fill(template.subject), body: fill(template.body) };
  }

  // ---------- delivery ----------

  private deliverInternal(state: NotificationState, templateKey: string, to: string, vars: Record<string, string>, opts: { userId?: string; link?: string } = {}): DeliveryLogEntry {
    const template = state.templates[templateKey];
    if (!template) throw new ApiException('not_found', 'Template not found');
    const { subject, body } = this.render(template, vars);
    const entry: DeliveryLogEntry = { id: newId('dl'), templateKey, to, subject, status: 'sent', at: now(), attempts: 1 };
    state.deliveryLog = [entry, ...state.deliveryLog].slice(0, MAX_LOG);
    if (to) this.mailbox.send({ to, subject, body, ...(opts.link ? { link: opts.link } : {}) });
    if (opts.userId) this.push(state, opts.userId, template.kind, subject, body.replace(/\s+/g, ' ').trim().slice(0, 160), opts.link);
    return entry;
  }

  /** Renders `templateKey` with `vars`, mails `to`, logs the delivery and (with `userId`) pushes a bell entry. */
  deliver(templateKey: string, to: string, vars: Record<string, string>, opts: { userId?: string; link?: string } = {}): DeliveryLogEntry {
    return this.transact((s) => this.deliverInternal(s, templateKey, to, vars, opts));
  }

  deliveryLog(): DeliveryLogEntry[] {
    return [...this.read().deliveryLog].sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Sample values for every template variable, for the admin "send test" action. */
  private sampleVars(template: MessageTemplate): Record<string, string> {
    const samples: Record<string, string> = { name: 'Test User', orderId: 'ORD-TEST123', total: formatMoney({ amount: 249900, currency: 'INR' }), title: 'A sample review', status: 'is now live on the product page', product: 'Sample Product', price: formatMoney({ amount: 149900, currency: 'INR' }), link: '/p/sample-product', returnId: 'RET-TEST123', store: 'Sample Store', outcome: 'approved', seller: 'Sample Seller', pickupDate: '12 Oct 2026', reason: 'The item was used', amount: formatMoney({ amount: 129900, currency: 'INR' }), method: 'original payment method', ticketId: 'TKT-TEST123', subject: 'A sample question' };
    return Object.fromEntries(template.variables.map((v) => [v, samples[v] ?? `{{${v}}}`]));
  }

  sendTest(key: string, to: string): void {
    const template = this.template(key);
    this.deliver(key, to, this.sampleVars(template));
  }

  retry(id: string, actor: string): DeliveryLogEntry {
    return this.transact((s) => {
      const entry = s.deliveryLog.find((e) => e.id === id);
      if (!entry) throw new ApiException('not_found', 'Delivery not found');
      if (entry.status === 'sent') return entry;
      const retried: DeliveryLogEntry = { ...entry, status: 'sent', attempts: entry.attempts + 1, reason: undefined };
      delete retried.reason;
      s.deliveryLog = s.deliveryLog.map((e) => (e.id === id ? retried : e));
      this.mailbox.send({ to: entry.to, subject: entry.subject, body: `Resent by ${actor} after a delivery failure.` });
      return retried;
    });
  }
}
