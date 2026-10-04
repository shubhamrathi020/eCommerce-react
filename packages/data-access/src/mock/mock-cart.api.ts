import { Injectable, inject } from '@shop/core';
import type { ShippingMethodId } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { CartApi } from '../lib/commerce.api';
import { MAX_LINE_QUANTITY, evaluateCoupon } from './cart-engine';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';

@Injectable()
export class MockCartApi extends CartApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockCartState);

  get() {
    return this.respond.okAsync(async () => (await this.state.priced()).cart);
  }

  add(variantId: string, quantity: number) {
    return this.respond.okAsync(async () => {
      const result = await this.state.mutate((stored, { products }) => {
        const variant = products.flatMap((p) => p.variants).find((v) => v.id === variantId);
        if (!variant) throw new ApiException('not_found', 'This product is no longer available.');
        if (variant.stock === 0 && !variant.backorder) throw new ApiException('validation', 'Sorry, this item is out of stock.');
        const existing = stored.items.find((i) => i.variantId === variantId);
        const max = variant.backorder ? MAX_LINE_QUANTITY : Math.min(MAX_LINE_QUANTITY, variant.stock);
        if (existing && existing.quantity >= max) throw new ApiException('validation', `You already have the maximum quantity (${max}) of this item.`);
        const items = existing
          ? stored.items.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(max, i.quantity + quantity) } : i))
          : [...stored.items, { variantId, quantity: Math.min(max, Math.max(1, quantity)), seenPrice: variant.price.amount }];
        return { ...stored, items };
      });
      return result.cart;
    });
  }

  setQuantity(variantId: string, quantity: number) {
    return this.respond.okAsync(async () => {
      const result = await this.state.mutate((stored) => ({
        ...stored,
        items: quantity <= 0 ? stored.items.filter((i) => i.variantId !== variantId) : stored.items.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(quantity, MAX_LINE_QUANTITY) } : i)),
      }));
      return result.cart;
    });
  }

  remove(variantId: string) {
    return this.setQuantity(variantId, 0);
  }

  applyCoupon(code: string) {
    return this.respond.okAsync(async () => {
      const current = await this.state.priced();
      const evaluated = evaluateCoupon(code, current.cart.totals.subtotal.amount, Date.now());
      if (!evaluated.ok) throw new ApiException('validation', evaluated.message, { code: evaluated.message });
      const result = await this.state.mutate((stored) => ({ ...stored, couponCode: evaluated.coupon.code }));
      return result.cart;
    });
  }

  removeCoupon() {
    return this.respond.okAsync(async () => {
      const result = await this.state.mutate(({ couponCode: _removed, ...rest }) => rest);
      return result.cart;
    });
  }

  setShippingMethod(method: ShippingMethodId) {
    return this.respond.okAsync(async () => (await this.state.mutate((stored) => ({ ...stored, shippingMethod: method }))).cart);
  }

  clear() {
    return this.respond.okAsync(async () => (await this.state.mutate((stored) => ({ items: [], shippingMethod: stored.shippingMethod }))).cart);
  }
}
