import { Injectable, inject } from '@shop/core';
import type { ApplyWalletInput, DealView, GiftCardCheck, Money, WalletSummary } from '@ecom/contracts';
import { ApiException, giftCardProblem } from '@ecom/contracts';
import { PromotionApi, WalletApi } from '../lib/promotion.api';
import { loadCatalogData } from './catalog-data';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';
import { MockOrderStore } from './mock-order-store';
import { MockUserStore } from './mock-user-store';
import { MockPromotionStore } from './promotion-store';
import { MockReturnStore } from './return-store';

@Injectable()
export class MockPromotionApi extends PromotionApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockPromotionStore);
  private readonly orders = inject(MockOrderStore);

  /** Live flash deals with product details and remaining units. */
  private async deals(): Promise<DealView[]> {
    const { products } = await loadCatalogData();
    const now = Date.now();
    const promotions = this.store.promotions(now);
    const remaining = this.store.flashRemaining(this.orders.all(), promotions);
    const out: DealView[] = [];
    for (const p of promotions) {
      if (p.kind !== 'flash' || !p.enabled || (p.startsAt && new Date(p.startsAt).getTime() > now) || !p.endsAt || new Date(p.endsAt).getTime() < now) continue;
      const left = remaining[p.id] ?? p.cap;
      const product = products.find((x) => x.id === p.productId);
      const variant = product?.variants.find((v) => !p.variantId || v.id === p.variantId) ?? product?.variants[0];
      if (left <= 0 || !product || !variant || p.dealPrice >= variant.price.amount) continue;
      out.push({ id: p.id, name: p.name, productId: product.id, ...(p.variantId ? { variantId: p.variantId } : {}), slug: product.slug, title: product.title, image: product.images[0], regularPrice: variant.price, dealPrice: { amount: p.dealPrice, currency: 'INR' }, remaining: left, cap: p.cap, endsAt: p.endsAt });
    }
    return out.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  }

  activeDeals() {
    return this.respond.okAsync<DealView[]>(() => this.deals());
  }

  dealFor(productId: string) {
    return this.respond.okAsync<DealView | null>(async () => (await this.deals()).find((d) => d.productId === productId) ?? null);
  }
}

@Injectable()
export class MockWalletApi extends WalletApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockPromotionStore);
  private readonly cart = inject(MockCartState);
  private readonly users = inject(MockUserStore);
  private readonly returns = inject(MockReturnStore);

  summary() {
    return this.respond.okAsync<WalletSummary>(async () => {
      const userId = this.users.currentUserId();
      const credit: Money = { amount: userId ? (this.returns.read().credit[userId] ?? 0) : 0, currency: 'INR' };
      return { credit };
    });
  }

  checkGiftCard(code: string) {
    return this.respond.okAsync<GiftCardCheck>(async () => {
      const card = this.store.giftCard(code);
      const problem = giftCardProblem(card, Date.now());
      if (problem || !card) throw new ApiException('validation', problem ?? 'This gift card code is not valid.', { code: problem ?? 'Not valid' });
      return { code: card.code, balance: { amount: card.balance, currency: 'INR' }, ...(card.expiresAt ? { expiresAt: card.expiresAt } : {}) };
    });
  }

  apply(input: ApplyWalletInput) {
    return this.respond.okAsync<void>(async () => {
      if (input.useCredit && !this.users.currentUserId()) throw new ApiException('unauthorized', 'Sign in to use your store credit.');
      if (typeof input.giftCardCode === 'string') {
        const card = this.store.giftCard(input.giftCardCode);
        const problem = giftCardProblem(card, Date.now());
        if (problem || !card) throw new ApiException('validation', problem ?? 'This gift card code is not valid.', { code: problem ?? 'Not valid' });
      }
      await this.cart.mutate((stored) => {
        const { giftCardCode: _g, useCredit: _u, ...rest } = stored;
        const giftCardCode = input.giftCardCode === undefined ? stored.giftCardCode : (input.giftCardCode?.trim().toUpperCase() ?? undefined);
        const useCredit = input.useCredit === undefined ? stored.useCredit : input.useCredit;
        return { ...rest, ...(giftCardCode ? { giftCardCode } : {}), ...(useCredit ? { useCredit: true } : {}) };
      });
    });
  }
}
