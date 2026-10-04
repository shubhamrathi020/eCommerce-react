import type { Observable } from 'rxjs';
import type {
  ApproveReturnInput,
  CreateReturnInput,
  CreateTicketInput,
  Money,
  OrderRefund,
  Paged,
  PendingOrderRefund,
  QualityCheckInput,
  RefundBreakdown,
  ReplyInput,
  ReturnEligibility,
  ReturnItemSelection,
  ReturnPolicy,
  ReturnQuery,
  ReturnRequest,
  SupportTicket,
  TicketQuery,
  TicketStatus,
} from '@ecom/contracts';

/**
 * Customer side of returns (BRD 13). Every call needs a signed-in customer and only ever sees that customer's own
 * orders and requests. Amounts are computed by the API, never by the browser.
 * Errors are `ApiException`s (`unauthorized`, `not_found`, `validation`, `conflict`).
 */
export abstract class ReturnApi {
  /** What can still be returned from an order, and why not when it can't (RF-01). */
  abstract eligibility(orderId: string): Observable<ReturnEligibility>;
  /** The refund these items would produce, shown before the customer submits (RF-03). */
  abstract quote(orderId: string, items: ReturnItemSelection[], reason: string): Observable<RefundBreakdown>;
  abstract create(input: CreateReturnInput): Observable<ReturnRequest>;
  /** The signed-in customer's requests, newest first. */
  abstract list(): Observable<ReturnRequest[]>;
  abstract get(id: string): Observable<ReturnRequest>;
  /** Withdraws a request that staff haven't approved yet. */
  abstract cancel(id: string): Observable<ReturnRequest>;
  /** Status of the refund for a cancelled, prepaid order; null when no refund is due (RF-04). */
  abstract orderRefund(orderId: string): Observable<OrderRefund | null>;
  /** Store credit balance from refunds that had no original method to go back to. */
  abstract storeCredit(): Observable<Money>;
}

/** Customer side of support tickets (RF-06). A customer only ever sees their own tickets. */
export abstract class SupportApi {
  abstract list(): Observable<SupportTicket[]>;
  abstract get(id: string): Observable<SupportTicket>;
  abstract create(input: CreateTicketInput): Observable<SupportTicket>;
  abstract reply(id: string, input: ReplyInput): Observable<SupportTicket>;
  abstract close(id: string): Observable<SupportTicket>;
}

/**
 * Staff returns queue. Needs `return:manage`; refunding a cancelled order also needs `order:refund`.
 * Every change is audited and notifies the customer. Errors: `forbidden`, `validation`, `not_found`.
 */
export abstract class AdminReturnApi {
  abstract list(query: ReturnQuery): Observable<Paged<ReturnRequest>>;
  abstract get(id: string): Observable<ReturnRequest>;
  abstract approve(id: string, input: ApproveReturnInput): Observable<ReturnRequest>;
  abstract reject(id: string, reason: string): Observable<ReturnRequest>;
  abstract markPickedUp(id: string): Observable<ReturnRequest>;
  /** Records the quality check; accepted items are restocked or scrapped, which writes the stock ledger (RF-05). */
  abstract recordCheck(id: string, input: QualityCheckInput): Observable<ReturnRequest>;
  /** Pays the refund out (RF-03). Only after an accepted quality check. */
  abstract refund(id: string): Observable<ReturnRequest>;
  abstract policy(): Observable<ReturnPolicy>;
  abstract savePolicy(input: Pick<ReturnPolicy, 'windowDays' | 'returnFee' | 'excludedCategoryIds' | 'excludedProductIds'>): Observable<ReturnPolicy>;
  /** Cancelled prepaid orders still waiting for their money to be sent back. */
  abstract pendingOrderRefunds(): Observable<PendingOrderRefund[]>;
  abstract refundOrder(orderId: string): Observable<OrderRefund>;
}

/** Staff support queue. Needs `support:manage`. */
export abstract class AdminSupportApi {
  abstract list(query: TicketQuery): Observable<Paged<SupportTicket>>;
  abstract get(id: string): Observable<SupportTicket>;
  abstract reply(id: string, input: ReplyInput): Observable<SupportTicket>;
  /** `null` unassigns. */
  abstract assign(id: string, assignee: string | null): Observable<SupportTicket>;
  abstract setStatus(id: string, status: TicketStatus): Observable<SupportTicket>;
}
