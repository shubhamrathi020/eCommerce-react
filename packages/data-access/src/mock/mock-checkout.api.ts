import { Injectable, inject } from '@shop/core';
import type { PaymentOption, ShippingOption } from '@ecom/contracts';
import { ApiException, codEligibility, deliverabilityProblem } from '@ecom/contracts';
import { CheckoutApi } from '../lib/commerce.api';
import { computeServiceability } from './catalog-data';
import { EXPRESS_SHIPPING, shippingFee } from './cart-engine';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';

const DAY_MS = 86_400_000;

export { codEligibility };

export function validateDeliverable(pincode: string): void {
  const problem = deliverabilityProblem(pincode, (p) => computeServiceability(p).serviceable);
  if (problem === 'invalid') throw new ApiException('validation', 'Enter a valid 6-digit pin code', { pincode: 'Invalid pin code' });
  if (problem === 'not_deliverable') throw new ApiException('validation', 'Sorry, we do not deliver to this pin code yet.', { pincode: 'Not deliverable' });
}

@Injectable()
export class MockCheckoutApi extends CheckoutApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockCartState);

  shippingOptions(pincode: string) {
    return this.respond.okAsync<ShippingOption[]>(async () => {
      validateDeliverable(pincode);
      const { cart } = await this.state.priced();
      const base = computeServiceability(pincode);
      const afterDiscount = cart.totals.subtotal.amount - (cart.totals.promotionDiscount?.amount ?? 0) - cart.totals.couponDiscount.amount;
      const free = cart.coupon?.freeShipping ?? false;
      const standardDays = base.estimatedDays ?? 3;
      const expressDays = Math.max(1, standardDays - 2);
      const on = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
      return [
        { id: 'standard', label: 'Standard delivery', price: { amount: shippingFee('standard', afterDiscount, free), currency: 'INR' }, estimatedDays: standardDays, estimatedDate: on(standardDays) },
        { id: 'express', label: 'Express delivery', price: { amount: free ? 0 : EXPRESS_SHIPPING, currency: 'INR' }, estimatedDays: expressDays, estimatedDate: on(expressDays) },
      ];
    });
  }

  paymentOptions(pincode: string) {
    return this.respond.okAsync<PaymentOption[]>(async () => {
      validateDeliverable(pincode);
      const { cart } = await this.state.priced();
      const cod = codEligibility(pincode, cart.totals.total.amount);
      return [
        { method: 'razorpay', label: 'Pay online (UPI, cards, net banking, wallets)', enabled: true },
        { method: 'cod', label: 'Cash on delivery', enabled: cod.enabled, ...(cod.reason ? { reason: cod.reason } : {}) },
      ];
    });
  }
}
