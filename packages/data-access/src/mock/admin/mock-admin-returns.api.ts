import { Injectable, inject } from '@shop/core';
import type { ApproveReturnInput, Disposition, OrderRefund, Paged, PendingOrderRefund, QualityCheckInput, ReplyInput, ReturnPolicy, ReturnQuery, ReturnRequest, ReturnStatus, SupportTicket, TicketQuery, TicketStatus } from '@ecom/contracts';
import { ApiException, TICKET_LIMITS } from '@ecom/contracts';
import { formatMoney } from '@shop/core';
import { AdminReturnApi, AdminSupportApi } from '../../lib/returns.api';
import { MAIN_LOCATION } from '../inventory-store';
import { createMockResponder } from '../mock-latency';
import { MockNotificationStore } from '../notification-store';
import { MockOrderStore } from '../mock-order-store';
import { MockReturnStore, RETURN_LIMITS, checkAttachments } from '../return-store';
import { newMessageId, validReplyText } from '../mock-return.api';
import { MockAdminState } from './admin-state';
import { loadProducts } from './mock-admin.api';

const DAY = 86_400_000;
const nowIso = () => new Date().toISOString();

function page<T>(rows: T[], pageNo: number, size: number): Paged<T> {
  const pageSize = Math.max(1, size);
  const p = Math.min(Math.max(1, pageNo), Math.max(1, Math.ceil(rows.length / pageSize)));
  return { items: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, page: p, pageSize };
}

const METHOD_LABEL = { original: 'your original payment method', store_credit: 'store credit' } as const;

@Injectable()
export class MockAdminReturnApi extends AdminReturnApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockReturnStore);
  private readonly orders = inject(MockOrderStore);
  private readonly notifications = inject(MockNotificationStore);

  list(query: ReturnQuery) {
    return this.respond.okAsync<Paged<ReturnRequest>>(async () => {
      this.state.require('return:manage');
      const q = query.q?.trim().toLowerCase();
      const rows = this.store
        .read()
        .returns.filter((r) => (!query.status || r.status === query.status) && (!q || r.id.toLowerCase().includes(q) || r.orderId.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || r.customerEmail.toLowerCase().includes(q)));
      return page(rows, query.page, query.pageSize);
    });
  }

  get(id: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      this.state.require('return:manage');
      return this.find(id);
    });
  }

  private find(id: string): ReturnRequest {
    const found = this.store.read().returns.find((r) => r.id === id);
    if (!found) throw new ApiException('not_found', 'Return not found');
    return found;
  }

  /** Moves a request along one allowed step, appends to its timeline, audits and notifies. */
  private step(id: string, from: ReturnStatus, to: ReturnStatus, label: string, change: (r: ReturnRequest, now: string, state: ReturnType<MockReturnStore['read']>) => void, audit: { action: string; detail: string }, notify?: { template: string; vars: (r: ReturnRequest) => Record<string, string> }): ReturnRequest {
    const updated = this.store.transact((s) => {
      const r = s.returns.find((x) => x.id === id);
      if (!r) throw new ApiException('not_found', 'Return not found');
      if (r.status !== from) throw new ApiException('validation', `This return is ${r.status.replace('_', ' ')}, so it cannot move to ${to.replace('_', ' ')}.`);
      const now = nowIso();
      change(r, now, s);
      r.status = to;
      r.updatedAt = now;
      r.timeline = [...r.timeline, { status: to, label, at: now, ...(audit.detail && to === 'rejected' ? { note: audit.detail } : {}) }];
      return r;
    });
    this.state.record(audit.action, id, audit.detail);
    if (notify) this.notifications.deliver(notify.template, updated.customerEmail, notify.vars(updated), { userId: updated.userId, link: `/account/returns/${id}` });
    return updated;
  }

  approve(id: string, input: ApproveReturnInput) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      this.state.require('return:manage');
      const today = new Date().toISOString().slice(0, 10);
      const picked = /^\d{4}-\d{2}-\d{2}$/.test(input.pickupDate) ? new Date(`${input.pickupDate}T00:00:00Z`).getTime() : NaN;
      if (Number.isNaN(picked)) throw new ApiException('validation', 'Choose a pickup date.', { pickupDate: 'Choose a pickup date' });
      if (input.pickupDate < today) throw new ApiException('validation', 'The pickup date cannot be in the past.', { pickupDate: 'Choose today or a later date' });
      if (picked - new Date(`${today}T00:00:00Z`).getTime() > 14 * DAY) throw new ApiException('validation', 'Schedule the pickup within the next 14 days.', { pickupDate: 'At most 14 days ahead' });
      const note = input.note?.trim();
      if ((note?.length ?? 0) > RETURN_LIMITS.note) throw new ApiException('validation', `Notes are limited to ${RETURN_LIMITS.note} characters.`, { note: 'Too long' });
      const pickupLabel = new Date(picked).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      return this.step(
        id,
        'requested',
        'approved',
        `Approved: pickup on ${pickupLabel}`,
        (r) => {
          r.pickup = { date: input.pickupDate, ...(note ? { note } : {}) };
        },
        { action: 'return.approve', detail: `Pickup ${input.pickupDate}` },
        { template: 'return_approved', vars: (r) => ({ name: r.customerName, returnId: r.id, pickupDate: pickupLabel }) },
      );
    });
  }

  reject(id: string, reason: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      this.state.require('return:manage');
      const clean = reason.trim();
      if (clean.length < 5) throw new ApiException('validation', 'Tell the customer why (at least 5 characters).', { reason: 'Give a reason' });
      if (clean.length > RETURN_LIMITS.rejection) throw new ApiException('validation', `Reasons are limited to ${RETURN_LIMITS.rejection} characters.`, { reason: 'Too long' });
      return this.step(id, 'requested', 'rejected', 'Request rejected', (r) => (r.rejectionReason = clean), { action: 'return.reject', detail: clean }, { template: 'return_rejected', vars: (r) => ({ name: r.customerName, returnId: r.id, reason: clean }) });
    });
  }

  markPickedUp(id: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      this.state.require('return:manage');
      return this.step(id, 'approved', 'picked_up', 'Items picked up', () => undefined, { action: 'return.pickup', detail: 'Marked as picked up' });
    });
  }

  recordCheck(id: string, input: QualityCheckInput) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      const actor = this.state.require('return:manage');
      const note = input.note.trim();
      if (!note) throw new ApiException('validation', 'Add a note about the item condition.', { note: 'Describe what you found' });
      if (note.length > RETURN_LIMITS.note) throw new ApiException('validation', `Notes are limited to ${RETURN_LIMITS.note} characters.`, { note: 'Too long' });
      const current = this.find(id);

      if (input.result === 'rejected') {
        return this.step(
          id,
          'picked_up',
          'rejected',
          'Failed the quality check',
          (r, now) => {
            r.check = { result: 'rejected', note, at: now, by: actor.name };
            r.rejectionReason = note;
          },
          { action: 'return.check', detail: `Rejected: ${note}` },
          { template: 'return_rejected', vars: (r) => ({ name: r.customerName, returnId: r.id, reason: note }) },
        );
      }

      const dispositions = input.dispositions ?? {};
      const missing = current.items.filter((i) => dispositions[i.variantId] !== 'restock' && dispositions[i.variantId] !== 'scrap');
      if (missing.length) throw new ApiException('validation', 'Choose restock or scrap for every item.', { dispositions: `Decide for: ${missing.map((m) => m.title).join(', ')}` });
      if (current.status !== 'picked_up') throw new ApiException('validation', `This return is ${current.status.replace('_', ' ')}, so it cannot be checked.`);

      // RF-05: the decision is written to the stock ledger. A scrapped unit is received and written off in one go,
      // so the ledger shows it came back and why it never became sellable again; the sale entry already removed it from stock.
      const baselines = (await loadProducts(this.state)).map((e) => e.baseline);
      for (const item of current.items) {
        const disposition = dispositions[item.variantId] as Disposition;
        const base = { variantId: item.variantId, locationId: MAIN_LOCATION, quantity: item.quantity, note: `Return ${id}` };
        this.state.inventory.adjust({ ...base, kind: 'return', reason: 'customer_return' }, baselines, actor.name);
        if (disposition === 'scrap') this.state.inventory.adjust({ ...base, kind: 'damage', reason: 'damaged', note: `Return ${id}: scrapped after quality check` }, baselines, actor.name);
      }
      return this.step(
        id,
        'picked_up',
        'checked',
        'Passed the quality check',
        (r, now) => {
          r.check = { result: 'accepted', note, at: now, by: actor.name };
          r.items = r.items.map((i) => ({ ...i, disposition: dispositions[i.variantId] as Disposition }));
        },
        { action: 'return.check', detail: `Accepted: ${current.items.map((i) => `${i.quantity} x ${i.title} (${dispositions[i.variantId]})`).join('; ')}` },
      );
    });
  }

  refund(id: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      this.state.require('return:manage');
      const done = this.step(
        id,
        'checked',
        'refunded',
        'Refund issued',
        (r, now, state) => {
          r.refundedAt = now;
          if (r.refund.method === 'store_credit') state.credit[r.userId] = (state.credit[r.userId] ?? 0) + r.refund.total.amount;
        },
        { action: 'return.refund', detail: `${formatMoney(this.find(id).refund.total)} to ${this.find(id).refund.method}` },
        { template: 'refund_issued', vars: (r) => ({ name: r.customerName, returnId: r.id, amount: formatMoney(r.refund.total), method: METHOD_LABEL[r.refund.method] }) },
      );
      return done;
    });
  }

  policy() {
    return this.respond.okAsync<ReturnPolicy>(async () => {
      this.state.require('return:manage');
      return this.store.policy();
    });
  }

  savePolicy(input: Pick<ReturnPolicy, 'windowDays' | 'returnFee' | 'excludedCategoryIds' | 'excludedProductIds'>) {
    return this.respond.okAsync<ReturnPolicy>(async () => {
      const actor = this.state.require('return:manage');
      const fields: Record<string, string> = {};
      if (!Number.isInteger(input.windowDays) || input.windowDays < 0 || input.windowDays > 90) fields['windowDays'] = 'Enter a whole number of days from 0 to 90';
      if (!Number.isInteger(input.returnFee) || input.returnFee < 0 || input.returnFee > 100_000) fields['returnFee'] = 'Enter an amount from 0 to 1,000';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      // New requests read the policy when they are created and keep a copy, so open requests are untouched (RF-07).
      const saved = this.store.transact((s) => {
        s.policy = { windowDays: input.windowDays, returnFee: input.returnFee, excludedCategoryIds: [...new Set(input.excludedCategoryIds)], excludedProductIds: [...new Set(input.excludedProductIds)], updatedAt: nowIso(), updatedBy: actor.name };
        return s.policy;
      });
      this.state.record('return.policy', 'policy', `Window ${saved.windowDays} days, fee ${formatMoney({ amount: saved.returnFee, currency: 'INR' })}, ${saved.excludedCategoryIds.length} categories and ${saved.excludedProductIds.length} products excluded`);
      return saved;
    });
  }

  pendingOrderRefunds() {
    return this.respond.okAsync<PendingOrderRefund[]>(async () => {
      this.state.require('order:refund');
      const records = this.store.read().orderRefunds;
      return this.orders
        .all()
        .filter((o) => o.paymentStatus === 'refund_pending' && !records[o.id]?.refundedAt)
        .map((o) => {
          const cancelled = o.timeline.find((t) => t.status === 'cancelled')?.at;
          return { orderId: o.id, customerName: o.contact.name, amount: o.totals.total, ...(cancelled ? { cancelledAt: cancelled } : {}) };
        });
    });
  }

  refundOrder(orderId: string) {
    return this.respond.okAsync<OrderRefund>(async () => {
      this.state.require('order:refund');
      const order = this.orders.find(orderId);
      if (!order) throw new ApiException('not_found', 'Order not found');
      if (order.paymentStatus !== 'refund_pending') throw new ApiException('validation', 'This order has no refund waiting.');
      const record = this.store.transact((s) => {
        if (s.orderRefunds[orderId]?.refundedAt) throw new ApiException('conflict', 'This order has already been refunded.');
        s.orderRefunds[orderId] = { orderId, amount: order.totals.total, method: 'original', refundedAt: nowIso() };
        return s.orderRefunds[orderId];
      });
      this.state.record('order.refund', orderId, `${formatMoney(record.amount)} refunded to the original payment method`);
      if (order.userId) this.notifications.deliver('refund_issued', order.contact.email, { name: order.contact.name, returnId: order.id, amount: formatMoney(record.amount), method: METHOD_LABEL.original }, { userId: order.userId, link: `/orders/${order.id}` });
      return record;
    });
  }
}

@Injectable()
export class MockAdminSupportApi extends AdminSupportApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockReturnStore);
  private readonly notifications = inject(MockNotificationStore);

  list(query: TicketQuery) {
    return this.respond.okAsync<Paged<SupportTicket>>(async () => {
      const actor = this.state.require('support:manage');
      const q = query.q?.trim().toLowerCase();
      const rows = this.store
        .read()
        .tickets.filter(
          (t) =>
            (!query.status || t.status === query.status) &&
            (query.assignee !== 'me' || t.assignee === actor.name) &&
            (query.assignee !== 'none' || !t.assignee) &&
            (!q || t.id.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.customerName.toLowerCase().includes(q) || (t.orderId ?? '').toLowerCase().includes(q)),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return page(rows, query.page, query.pageSize);
    });
  }

  get(id: string) {
    return this.respond.okAsync<SupportTicket>(async () => {
      this.state.require('support:manage');
      const found = this.store.read().tickets.find((t) => t.id === id);
      if (!found) throw new ApiException('not_found', 'Ticket not found');
      return found;
    });
  }

  reply(id: string, input: ReplyInput) {
    return this.respond.okAsync<SupportTicket>(async () => {
      const actor = this.state.require('support:manage');
      const body = validReplyText(input.message);
      const attachments = checkAttachments(input.attachments);
      const ticket = this.store.transact((s) => {
        const t = s.tickets.find((x) => x.id === id);
        if (!t) throw new ApiException('not_found', 'Ticket not found');
        if (t.status === 'closed') throw new ApiException('validation', 'This ticket is closed. Reopen it before replying.');
        const now = nowIso();
        t.messages = [...t.messages, { id: newMessageId(), author: 'staff', authorName: actor.name, body, attachments, at: now }];
        t.status = 'pending';
        // Whoever answers first takes the ticket.
        t.assignee ??= actor.name;
        t.updatedAt = now;
        return t;
      });
      this.state.record('support.reply', id, 'Replied to the customer');
      this.notifications.deliver('support_reply', ticket.customerEmail, { name: ticket.customerName, ticketId: ticket.id, subject: ticket.subject.slice(0, TICKET_LIMITS.subject) }, { userId: ticket.userId, link: `/account/support/${id}` });
      return ticket;
    });
  }

  assign(id: string, assignee: string | null) {
    return this.respond.okAsync<SupportTicket>(async () => {
      this.state.require('support:manage');
      const name = assignee?.trim();
      const ticket = this.store.transact((s) => {
        const t = s.tickets.find((x) => x.id === id);
        if (!t) throw new ApiException('not_found', 'Ticket not found');
        if (name) t.assignee = name;
        else delete t.assignee;
        t.updatedAt = nowIso();
        return t;
      });
      this.state.record('support.assign', id, name ? `Assigned to ${name}` : 'Unassigned');
      return ticket;
    });
  }

  setStatus(id: string, status: TicketStatus) {
    return this.respond.okAsync<SupportTicket>(async () => {
      this.state.require('support:manage');
      if (!['open', 'pending', 'closed'].includes(status)) throw new ApiException('validation', 'Unknown status.');
      const ticket = this.store.transact((s) => {
        const t = s.tickets.find((x) => x.id === id);
        if (!t) throw new ApiException('not_found', 'Ticket not found');
        t.status = status;
        t.updatedAt = nowIso();
        return t;
      });
      this.state.record('support.status', id, `Set to ${status}`);
      return ticket;
    });
  }
}
