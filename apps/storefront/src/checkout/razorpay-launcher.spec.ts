import type { PaymentSession } from '@ecom/contracts';
import { MOCK_RAZORPAY_KEY_ID } from '@shop/data-access';
import { createInjector } from '@shop/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoPaymentLauncher, MockPaymentLauncher, RazorpayPaymentLauncher } from './payment';

const session: PaymentSession = { orderId: 'ORD-1', providerOrderId: 'order_ABC', keyId: 'rzp_test_realkey', amount: 230900, currency: 'INR' };

type Handlers = { handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void; modal: { ondismiss: () => void } };

/** A stand-in for Checkout.js that records its options and lets the test play the shopper. */
function fakeCheckout() {
  const created: { options: Record<string, unknown> & Handlers; failed?: (r: { error?: { description?: string } }) => void }[] = [];
  window.Razorpay = class {
    private readonly record: (typeof created)[number];
    constructor(options: Record<string, unknown> & Handlers) {
      this.record = { options };
      created.push(this.record);
    }
    on(_event: string, handler: (r: { error?: { description?: string } }) => void) {
      this.record.failed = handler;
    }
    open() {}
  } as unknown as typeof window.Razorpay;
  return created;
}

describe('RazorpayPaymentLauncher', () => {
  beforeEach(() => {
    delete window.Razorpay;
  });
  afterEach(() => {
    delete window.Razorpay;
    document.head.querySelectorAll('script[src*="razorpay"]').forEach((s) => s.remove());
  });

  it('opens the window with the order, public key and what the shopper already entered', async () => {
    const created = fakeCheckout();
    const launcher = createInjector([]).get(RazorpayPaymentLauncher);
    const pending = launcher.open(session, { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].options).toMatchObject({
      key: 'rzp_test_realkey',
      order_id: 'order_ABC',
      amount: 230900,
      currency: 'INR',
      prefill: { name: 'Asha Rao', email: 'asha@example.com', contact: '+919876543210' },
    });
    created[0].options.modal.ondismiss();
    await pending;
  });

  it('reports the three values the server needs to verify a successful payment', async () => {
    const created = fakeCheckout();
    const pending = createInjector([]).get(RazorpayPaymentLauncher).open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].options.handler({ razorpay_order_id: 'order_ABC', razorpay_payment_id: 'pay_XYZ', razorpay_signature: 'sig123' });
    await expect(pending).resolves.toEqual({ status: 'success', result: { providerOrderId: 'order_ABC', providerPaymentId: 'pay_XYZ', signature: 'sig123' } });
  });

  it('a failure is reported only when the shopper closes the window, so a retry inside it is not lost', async () => {
    const created = fakeCheckout();
    const pending = createInjector([]).get(RazorpayPaymentLauncher).open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].failed?.({ error: { description: 'Your card was declined' } });
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // the window is still open: the shopper may try another method
    created[0].options.modal.ondismiss();
    await expect(pending).resolves.toEqual({ status: 'failed', reason: 'Your card was declined' });
  });

  it('a payment that succeeds after a failed first attempt is a success', async () => {
    const created = fakeCheckout();
    const pending = createInjector([]).get(RazorpayPaymentLauncher).open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].failed?.({ error: { description: 'Your card was declined' } });
    created[0].options.handler({ razorpay_order_id: 'order_ABC', razorpay_payment_id: 'pay_RETRY', signature: 'x' } as never);
    created[0].options.modal.ondismiss(); // Razorpay closes its window afterwards
    await expect(pending).resolves.toMatchObject({ status: 'success', result: { providerPaymentId: 'pay_RETRY' } });
  });

  it('closing the window without paying is a dismissal, not a failure', async () => {
    const created = fakeCheckout();
    const pending = createInjector([]).get(RazorpayPaymentLauncher).open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].options.modal.ondismiss();
    await expect(pending).resolves.toEqual({ status: 'dismissed' });
  });

  it('a script that cannot be loaded is a failed payment and can be tried again', async () => {
    const launcher = createInjector([]).get(RazorpayPaymentLauncher);
    const first = launcher.open(session);
    await vi.waitFor(() => expect(document.head.querySelector('script[src*="checkout.razorpay.com"]')).not.toBeNull());
    document.head.querySelector('script[src*="checkout.razorpay.com"]')?.dispatchEvent(new Event('error'));
    await expect(first).resolves.toEqual({ status: 'failed', reason: 'The payment window could not be loaded' });

    const created = fakeCheckout();
    const second = launcher.open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0].options.modal.ondismiss();
    await expect(second).resolves.toEqual({ status: 'dismissed' });
  });
});

describe('AutoPaymentLauncher', () => {
  it('uses the mock dialog for the mock data layer and Razorpay for any real backend', async () => {
    const injector = createInjector([]);
    const auto = injector.get(AutoPaymentLauncher);
    const mock = injector.get(MockPaymentLauncher);
    const razorpay = injector.get(RazorpayPaymentLauncher);
    const openMock = vi.spyOn(mock, 'open').mockResolvedValue({ status: 'dismissed' });
    const openRazorpay = vi.spyOn(razorpay, 'open').mockResolvedValue({ status: 'dismissed' });

    await auto.open({ ...session, keyId: MOCK_RAZORPAY_KEY_ID });
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openRazorpay).not.toHaveBeenCalled();

    await auto.open(session, { email: 'a@example.com' });
    expect(openRazorpay).toHaveBeenCalledWith(session, { email: 'a@example.com' });
  });
});
