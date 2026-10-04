import { Injectable, inject } from '@shop/core';
import type { CreateReturnInput, CreateTicketInput, Money, Order, OrderRefund, RefundBreakdown, ReplyInput, ReturnEligibility, ReturnItemSelection, ReturnRequest, SupportTicket } from '@ecom/contracts';
import { ApiException, TICKET_LIMITS, computeRefund, reasonOf } from '@ecom/contracts';
import { ReturnApi, SupportApi } from '../lib/returns.api';
import { loadCatalogData } from './catalog-data';
import { createMockResponder } from './mock-latency';
import { MockNotificationStore } from './notification-store';
import { MockOrderStore, withProgress } from './mock-order-store';
import { MockUserStore } from './mock-user-store';
import { MockSellerStore } from './seller-store';
import { RETURN_LIMITS, MockReturnStore, checkAttachments, eligibilityFor, newReturnId } from './return-store';

const inr = (amount: number): Money => ({ amount, currency: 'INR' });

/** A signed-in customer holding `permission`; the server-side check the browser guards only mirror. */
export function requireCustomer(users: MockUserStore, permission: string) {
  const session = users.session();
  if (!session) throw new ApiException('unauthorized', 'Please sign in.');
  if (!session.user.permissions.includes(permission)) throw new ApiException('forbidden', 'You do not have permission to do that.');
  return session.user;
}

@Injectable()
export class MockReturnApi extends ReturnApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly orders = inject(MockOrderStore);
  private readonly store = inject(MockReturnStore);
  private readonly notifications = inject(MockNotificationStore);
  private readonly sellers = inject(MockSellerStore);

  /** The customer's own order, with delivery progress applied; anything else is "not found" so other people's orders can't be probed. */
  private ownOrder(userId: string, orderId: string): Order {
    const found = this.orders.find(orderId);
    if (!found || found.userId !== userId) throw new ApiException('not_found', 'Order not found');
    // A multi-seller order is delivered only when every shipment is, and a return window counts from then.
    return this.sellers.applyShipments(withProgress(found, Date.now()));
  }

  private async eligible(userId: string, orderId: string): Promise<{ order: Order; eligibility: ReturnEligibility }> {
    const order = this.ownOrder(userId, orderId);
    const { products } = await loadCatalogData();
    const state = this.store.read();
    return { order, eligibility: eligibilityFor(order, state.returns, state.policy, products, Date.now()) };
  }

  /** Validates the chosen items against eligibility; returns clean selections. */
  private selections(eligibility: ReturnEligibility, items: ReturnItemSelection[]): ReturnItemSelection[] {
    const chosen = items.filter((i) => i.quantity > 0);
    if (chosen.length === 0) throw new ApiException('validation', 'Choose at least one item to return.', { items: 'Choose at least one item' });
    for (const sel of chosen) {
      const line = eligibility.lines.find((l) => l.variantId === sel.variantId);
      if (!line) throw new ApiException('validation', 'One of the items is not part of this order.', { items: 'Unknown item' });
      if (line.returnable === 0) throw new ApiException(line.inOpenRequest > 0 ? 'conflict' : 'validation', line.blockedReason ?? 'This item cannot be returned.', { items: `${line.title}: ${line.blockedReason ?? 'cannot be returned'}` });
      if (!Number.isInteger(sel.quantity) || sel.quantity > line.returnable) throw new ApiException('validation', `You can return at most ${line.returnable} of ${line.title}.`, { items: `${line.title}: at most ${line.returnable}` });
    }
    return chosen;
  }

  eligibility(orderId: string) {
    return this.respond.okAsync<ReturnEligibility>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      return (await this.eligible(user.id, orderId)).eligibility;
    });
  }

  quote(orderId: string, items: ReturnItemSelection[], reason: string) {
    return this.respond.okAsync<RefundBreakdown>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      const { order, eligibility } = await this.eligible(user.id, orderId);
      const chosen = this.selections(eligibility, items);
      const state = this.store.read();
      return computeRefund(order, chosen, reason, state.policy, this.returnedUnits(state.returns, orderId));
    });
  }

  private returnedUnits(returns: ReturnRequest[], orderId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of returns.filter((x) => x.orderId === orderId && x.status === 'refunded')) for (const i of r.items) out[i.variantId] = (out[i.variantId] ?? 0) + i.quantity;
    return out;
  }

  create(input: CreateReturnInput) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      const { order, eligibility } = await this.eligible(user.id, input.orderId);
      if (!eligibility.eligible) {
        const open = eligibility.lines.some((l) => l.inOpenRequest > 0);
        throw new ApiException(open ? 'conflict' : 'validation', eligibility.reason ?? 'This order cannot be returned.');
      }
      const fields: Record<string, string> = {};
      if (!reasonOf(input.reason)) fields['reason'] = 'Choose a reason';
      if (input.comments.length > RETURN_LIMITS.comments) fields['comments'] = `Comments are limited to ${RETURN_LIMITS.comments} characters`;
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const attachments = checkAttachments(input.attachments);
      const chosen = this.selections(eligibility, input.items);

      const now = new Date().toISOString();
      const request = this.store.transact((state) => {
        // Re-check against the freshest state: a second tab may have just opened a request for the same item.
        const fresh = eligibilityFor(order, state.returns, state.policy, [], Date.now());
        for (const sel of chosen) {
          const line = fresh.lines.find((l) => l.variantId === sel.variantId);
          if (!line || line.inOpenRequest > 0) throw new ApiException('conflict', 'A return request for one of these items is already open.');
        }
        const refund = computeRefund(order, chosen, input.reason, state.policy, this.returnedUnits(state.returns, order.id));
        const created: ReturnRequest = {
          id: newReturnId('RET'),
          orderId: order.id,
          userId: user.id,
          customerName: user.name,
          customerEmail: user.email,
          status: 'requested',
          reason: input.reason,
          comments: input.comments.trim(),
          items: chosen.map((sel) => {
            const line = order.lines.find((l) => l.variantId === sel.variantId) as Order['lines'][number];
            return { variantId: line.variantId, productId: line.productId, slug: line.slug, title: line.title, image: line.image, options: line.options, quantity: sel.quantity, unitPrice: line.unitPrice };
          }),
          refund,
          policy: { windowDays: state.policy.windowDays, returnFee: state.policy.returnFee },
          attachments,
          timeline: [{ status: 'requested', label: 'Return requested', at: now }],
          createdAt: now,
          updatedAt: now,
        };
        state.returns = [created, ...state.returns];
        return created;
      });
      this.notifications.deliver('return_requested', user.email, { name: user.name, returnId: request.id, orderId: order.id }, { userId: user.id, link: `/account/returns/${request.id}` });
      return request;
    });
  }

  list() {
    return this.respond.okAsync<ReturnRequest[]>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      return this.store.read().returns.filter((r) => r.userId === user.id);
    });
  }

  get(id: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      const found = this.store.read().returns.find((r) => r.id === id && r.userId === user.id);
      if (!found) throw new ApiException('not_found', 'Return not found');
      return found;
    });
  }

  cancel(id: string) {
    return this.respond.okAsync<ReturnRequest>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      return this.store.transact((state) => {
        const found = state.returns.find((r) => r.id === id && r.userId === user.id);
        if (!found) throw new ApiException('not_found', 'Return not found');
        if (found.status !== 'requested') throw new ApiException('validation', 'Only a request that has not been approved yet can be withdrawn.');
        const now = new Date().toISOString();
        // A withdrawn request frees its items, so the customer may start a new one.
        found.status = 'rejected';
        found.rejectionReason = 'Withdrawn by you';
        found.timeline = [...found.timeline, { status: 'rejected', label: 'Request withdrawn', at: now }];
        found.updatedAt = now;
        return found;
      });
    });
  }

  orderRefund(orderId: string) {
    return this.respond.okAsync<OrderRefund | null>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      const order = this.ownOrder(user.id, orderId);
      if (order.paymentStatus !== 'refund_pending') return null;
      return this.store.read().orderRefunds[orderId] ?? { orderId, amount: order.totals.total, method: 'original' as const };
    });
  }

  storeCredit() {
    return this.respond.okAsync<Money>(async () => {
      const user = requireCustomer(this.users, 'return:write:own');
      return inr(this.store.read().credit[user.id] ?? 0);
    });
  }
}

let ticketCounter = 0;
const newMessageId = () => `msg_${Date.now().toString(36)}${(ticketCounter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;

/** Shared by the customer and staff reply paths. */
export function validReplyText(text: string): string {
  const clean = text.trim();
  if (!clean) throw new ApiException('validation', 'Write a message first.', { message: 'A message cannot be empty' });
  if (clean.length > TICKET_LIMITS.message) throw new ApiException('validation', `Messages are limited to ${TICKET_LIMITS.message} characters.`, { message: `At most ${TICKET_LIMITS.message} characters` });
  return clean;
}

export { newMessageId };

@Injectable()
export class MockSupportApi extends SupportApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly orders = inject(MockOrderStore);
  private readonly store = inject(MockReturnStore);

  list() {
    return this.respond.okAsync<SupportTicket[]>(async () => {
      const user = requireCustomer(this.users, 'support:write:own');
      return this.store
        .read()
        .tickets.filter((t) => t.userId === user.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  get(id: string) {
    return this.respond.okAsync<SupportTicket>(async () => {
      const user = requireCustomer(this.users, 'support:write:own');
      const found = this.store.read().tickets.find((t) => t.id === id && t.userId === user.id);
      if (!found) throw new ApiException('not_found', 'Ticket not found');
      return found;
    });
  }

  create(input: CreateTicketInput) {
    return this.respond.okAsync<SupportTicket>(async () => {
      const user = requireCustomer(this.users, 'support:write:own');
      const fields: Record<string, string> = {};
      const subject = input.subject.trim();
      if (!subject) fields['subject'] = 'Add a short subject';
      else if (subject.length > TICKET_LIMITS.subject) fields['subject'] = `At most ${TICKET_LIMITS.subject} characters`;
      let message = '';
      try {
        message = validReplyText(input.message);
      } catch (e) {
        fields['message'] = (e as ApiException).fields?.['message'] ?? 'Write a message';
      }
      if (input.orderId) {
        const order = this.orders.find(input.orderId);
        if (!order || order.userId !== user.id) fields['orderId'] = 'Choose one of your orders';
      }
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const attachments = checkAttachments(input.attachments);
      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: newReturnId('TKT'),
        userId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        subject,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        status: 'open',
        messages: [{ id: newMessageId(), author: 'customer', authorName: user.name, body: message, attachments, at: now }],
        createdAt: now,
        updatedAt: now,
      };
      this.store.transact((s) => {
        s.tickets = [ticket, ...s.tickets];
      });
      return ticket;
    });
  }

  reply(id: string, input: ReplyInput) {
    return this.respond.okAsync<SupportTicket>(async () => {
      const user = requireCustomer(this.users, 'support:write:own');
      const body = validReplyText(input.message);
      const attachments = checkAttachments(input.attachments);
      return this.store.transact((s) => {
        const ticket = s.tickets.find((t) => t.id === id && t.userId === user.id);
        if (!ticket) throw new ApiException('not_found', 'Ticket not found');
        if (ticket.status === 'closed') throw new ApiException('validation', 'This ticket is closed. Start a new one if you still need help.');
        const now = new Date().toISOString();
        ticket.messages = [...ticket.messages, { id: newMessageId(), author: 'customer', authorName: user.name, body, attachments, at: now }];
        ticket.status = 'open';
        ticket.updatedAt = now;
        return ticket;
      });
    });
  }

  close(id: string) {
    return this.respond.okAsync<SupportTicket>(async () => {
      const user = requireCustomer(this.users, 'support:write:own');
      return this.store.transact((s) => {
        const ticket = s.tickets.find((t) => t.id === id && t.userId === user.id);
        if (!ticket) throw new ApiException('not_found', 'Ticket not found');
        ticket.status = 'closed';
        ticket.updatedAt = new Date().toISOString();
        return ticket;
      });
    });
  }
}
