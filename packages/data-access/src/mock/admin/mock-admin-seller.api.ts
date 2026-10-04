import { Injectable, inject } from '@shop/core';
import type { CommissionRule, PayoutPreview, PayoutStatement, Seller, SellerProduct, SellerStatus } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { formatMoney } from '@shop/core';
import { AdminSellerApi, type AdminSellerProduct, type CommissionRuleInput, type SellerWithCounts } from '../../lib/marketplace.api';
import { loadCatalogData } from '../catalog-data';
import { createMockResponder } from '../mock-latency';
import { MockNotificationStore } from '../notification-store';
import { MockUserStore } from '../mock-user-store';
import { PayoutCalculator } from '../payouts';
import { MockSellerStore, newSellerId } from '../seller-store';
import { MockAdminState } from './admin-state';

const REASON_MAX = 300;

function cleanReason(approve: boolean, reason: string | undefined): string | undefined {
  const text = reason?.trim();
  if (!approve && (!text || text.length < 5)) throw new ApiException('validation', 'Tell them why (at least 5 characters).', { reason: 'Give a reason' });
  if ((text?.length ?? 0) > REASON_MAX) throw new ApiException('validation', `Reasons are limited to ${REASON_MAX} characters.`, { reason: 'Too long' });
  return approve ? undefined : text;
}

@Injectable()
export class MockAdminSellerApi extends AdminSellerApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockSellerStore);
  private readonly users = inject(MockUserStore);
  private readonly notifications = inject(MockNotificationStore);
  private readonly payoutCalc = inject(PayoutCalculator);

  private seller(id: string): Seller {
    const found = this.store.seller(id);
    if (!found) throw new ApiException('not_found', 'Seller not found');
    return found;
  }

  /** Tells the applicant. The seeded demo applicants have no mailbox, so a missing user is simply skipped. */
  private tell(seller: Seller, template: string, vars: Record<string, string>): void {
    const owner = this.users.users().find((u) => u.id === seller.ownerUserId);
    if (owner) this.notifications.deliver(template, owner.email, { name: owner.name, ...vars }, { userId: owner.id });
  }

  sellers(status?: SellerStatus) {
    return this.respond.okAsync<SellerWithCounts[]>(async () => {
      this.state.require('seller:manage');
      const products = this.store.products();
      return this.store
        .sellers()
        .filter((s) => !status || s.status === status)
        .map((s) => ({ ...s, liveProducts: products.filter((p) => p.sellerId === s.id && p.status === 'approved').length, pendingProducts: products.filter((p) => p.sellerId === s.id && p.status === 'pending').length }))
        .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
    });
  }

  decideSeller(id: string, decision: { approve: boolean; reason?: string }) {
    return this.respond.okAsync<Seller>(async () => {
      const actor = this.state.require('seller:manage');
      const reason = cleanReason(decision.approve, decision.reason);
      const current = this.seller(id);
      if (current.status !== 'pending') throw new ApiException('validation', `This application is already ${current.status}.`);
      const now = new Date().toISOString();
      const decided = this.store.transact((s) => {
        const x = s.sellers.find((y) => y.id === id) as Seller;
        x.status = decision.approve ? 'approved' : 'rejected';
        x.decidedAt = now;
        x.decidedBy = actor.name;
        if (reason) x.rejectionReason = reason;
        else delete x.rejectionReason;
        return { ...x };
      });
      if (decision.approve) {
        // Approval is what gives the applicant seller access: they gain the role and see the portal at their next sign in.
        const owner = this.users.users().find((u) => u.id === decided.ownerUserId);
        if (owner && !owner.roles.includes('seller')) this.users.update({ ...owner, roles: [...owner.roles, 'seller'] });
      }
      this.state.record(decision.approve ? 'seller.approve' : 'seller.reject', id, reason ?? decided.displayName);
      this.tell(decided, 'seller_decision', { store: decided.displayName, outcome: decision.approve ? 'approved' : 'not approved', reason: reason ? `Reason: ${reason}` : 'You can now sign in to the seller portal.' });
      return decided;
    });
  }

  setStanding(id: string, status: 'approved' | 'suspended') {
    return this.respond.okAsync<Seller>(async () => {
      this.state.require('seller:manage');
      const current = this.seller(id);
      if (current.status !== 'approved' && current.status !== 'suspended') throw new ApiException('validation', 'Only an approved seller can be suspended or restored.');
      const updated = this.store.transact((s) => {
        const x = s.sellers.find((y) => y.id === id) as Seller;
        x.status = status;
        return { ...x };
      });
      this.state.record(status === 'suspended' ? 'seller.suspend' : 'seller.restore', id, updated.displayName);
      return updated;
    });
  }

  setCommission(id: string, percent: number | null) {
    return this.respond.okAsync<Seller>(async () => {
      this.state.require('seller:manage');
      this.seller(id);
      if (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 50)) throw new ApiException('validation', 'Commission is between 0% and 50%.', { percent: 'Enter 0 to 50' });
      const updated = this.store.transact((s) => {
        const x = s.sellers.find((y) => y.id === id) as Seller;
        if (percent === null) delete x.commissionRate;
        else x.commissionRate = percent;
        return { ...x };
      });
      this.state.record('seller.commission', id, percent === null ? 'Use the rules' : `${percent}%`);
      return updated;
    });
  }

  products(status?: SellerProduct['status']) {
    return this.respond.okAsync<AdminSellerProduct[]>(async () => {
      this.state.require('seller:manage');
      const names = new Map(this.store.sellers().map((s) => [s.id, s.displayName]));
      return this.store
        .products()
        .filter((p) => !status || p.status === status)
        .map((p) => ({ ...p, sellerName: names.get(p.sellerId) ?? p.sellerId }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  decideProduct(id: string, decision: { approve: boolean; reason?: string }) {
    return this.respond.okAsync<SellerProduct>(async () => {
      this.state.require('seller:manage');
      const reason = cleanReason(decision.approve, decision.reason);
      const current = this.store.products().find((p) => p.id === id);
      if (!current) throw new ApiException('not_found', 'Product not found');
      if (current.status !== 'pending') throw new ApiException('validation', `This listing is ${current.status === 'approved' ? 'already live' : current.status === 'rejected' ? 'already rejected' : 'not waiting for approval'}.`);
      const decided = this.store.transact((s) => {
        const x = s.products.find((y) => y.id === id) as SellerProduct;
        x.status = decision.approve ? 'approved' : 'rejected';
        x.updatedAt = new Date().toISOString();
        if (reason) x.rejectionReason = reason;
        else delete x.rejectionReason;
        return { ...x };
      });
      this.state.record(decision.approve ? 'seller.product.approve' : 'seller.product.reject', id, reason ?? decided.title);
      const seller = this.store.seller(decided.sellerId);
      if (seller) this.tell(seller, 'seller_product_decision', { product: decided.title, outcome: decision.approve ? 'approved and is now live' : 'not approved', reason: reason ? `Reason: ${reason}` : '' });
      return decided;
    });
  }

  rules() {
    return this.respond.okAsync<CommissionRule[]>(async () => {
      this.state.require('seller:manage');
      return this.store.rules();
    });
  }

  saveRule(input: CommissionRuleInput) {
    return this.respond.okAsync<CommissionRule>(async () => {
      this.state.require('seller:manage');
      const { categories } = await loadCatalogData();
      const fields: Record<string, string> = {};
      if (typeof input.percent !== 'number' || !Number.isFinite(input.percent) || input.percent < 0 || input.percent > 50) fields['percent'] = 'Enter 0 to 50';
      if (input.scope === 'category' && !categories.some((c) => c.id === input.categoryId)) fields['categoryId'] = 'Choose a category';
      if (input.scope === 'seller' && !this.store.seller(input.sellerId ?? '')) fields['sellerId'] = 'Choose a seller';
      if (!['default', 'category', 'seller'].includes(input.scope)) fields['scope'] = 'Choose where the rule applies';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const rule: CommissionRule = { id: input.id ?? newSellerId('rule'), scope: input.scope, percent: input.percent, ...(input.scope === 'category' ? { categoryId: input.categoryId } : {}), ...(input.scope === 'seller' ? { sellerId: input.sellerId } : {}) };
      this.store.transact((s) => {
        // One rule per place it applies, so the answer to "what is the commission here" is never ambiguous.
        const clash = s.rules.find((r) => r.id !== rule.id && r.scope === rule.scope && r.categoryId === rule.categoryId && r.sellerId === rule.sellerId);
        if (clash) throw new ApiException('conflict', 'There is already a rule for that. Edit it instead.', { scope: 'Already exists' });
        s.rules = s.rules.some((r) => r.id === rule.id) ? s.rules.map((r) => (r.id === rule.id ? rule : r)) : [...s.rules, rule];
      });
      this.state.record('commission.rule', rule.id, `${rule.scope} ${rule.percent}%`);
      return rule;
    });
  }

  removeRule(id: string) {
    return this.respond.okAsync<void>(async () => {
      this.state.require('seller:manage');
      const rule = this.store.rules().find((r) => r.id === id);
      if (!rule) throw new ApiException('not_found', 'Rule not found');
      if (rule.scope === 'default') throw new ApiException('validation', 'The default rule cannot be removed, only changed.');
      this.store.transact((s) => {
        s.rules = s.rules.filter((r) => r.id !== id);
      });
      this.state.record('commission.rule.remove', id, `${rule.scope}`);
    });
  }

  payoutPreview(sellerId: string, from: string, to: string) {
    return this.respond.okAsync<PayoutPreview>(async () => {
      this.state.require('seller:manage');
      return this.payoutCalc.preview(sellerId, from, to);
    });
  }

  issuePayout(sellerId: string, from: string, to: string) {
    return this.respond.okAsync<PayoutStatement>(async () => {
      this.state.require('seller:manage');
      const preview = await this.payoutCalc.preview(sellerId, from, to);
      if (preview.lines.length === 0 && preview.adjustments.length === 0) throw new ApiException('validation', 'Nothing to pay out in that period.');
      if (preview.net < 0) throw new ApiException('validation', 'Returns exceed sales in that period, so the balance is negative. Choose a longer period.');
      const statement: PayoutStatement = { id: newSellerId('PAY').toUpperCase(), sellerId, sellerName: preview.sellerName, from, to, lines: preview.lines, adjustments: preview.adjustments, gross: preview.gross, commission: preview.commission, net: preview.net, status: 'issued', issuedAt: new Date().toISOString() };
      this.store.transact((s) => {
        // Re-check inside the write: a statement issued in the meantime has already claimed these shipments.
        const claimed = new Set(s.statements.flatMap((st) => st.lines.map((l) => l.shipmentId)));
        if (preview.lines.some((l) => claimed.has(l.shipmentId))) throw new ApiException('conflict', 'Some of these sales are already on a statement. Refresh and try again.');
        for (const sh of s.shipments) if (preview.lines.some((l) => l.shipmentId === sh.id)) sh.statementId = statement.id;
        s.statements = [statement, ...s.statements];
      });
      this.state.record('payout.issue', statement.id, `${preview.sellerName}: net ${formatMoney({ amount: statement.net, currency: 'INR' })}`);
      return statement;
    });
  }

  statements() {
    return this.respond.okAsync<PayoutStatement[]>(async () => {
      this.state.require('seller:manage');
      return [...this.store.statements()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    });
  }

  markPaid(statementId: string, reference: string) {
    return this.respond.okAsync<PayoutStatement>(async () => {
      this.state.require('seller:manage');
      const ref = reference.trim();
      if (ref.length < 4 || ref.length > 60) throw new ApiException('validation', 'Enter the bank transfer reference (4 to 60 characters).', { reference: 'Enter the transfer reference' });
      const paid = this.store.transact((s) => {
        const st = s.statements.find((x) => x.id === statementId);
        if (!st) throw new ApiException('not_found', 'Statement not found');
        if (st.status === 'paid') throw new ApiException('conflict', 'This statement is already marked as paid.');
        st.status = 'paid';
        st.paidAt = new Date().toISOString();
        st.reference = ref;
        return { ...st };
      });
      this.state.record('payout.paid', statementId, ref);
      return paid;
    });
  }
}
