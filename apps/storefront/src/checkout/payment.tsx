import { useEffect, useRef } from 'react';
import type { PaymentResult, PaymentSession } from '@ecom/contracts';
import { Injectable, inject, signal, useMoney, useService, useSignal } from '@shop/core';
import { MOCK_RAZORPAY_KEY_ID, mockSignature } from '@shop/data-access';
import { Button, useFocusTrap } from '@shop/ui';

export type PaymentOutcome = { status: 'success'; result: PaymentResult } | { status: 'failed'; reason: string } | { status: 'dismissed' };

/** What the shopper already told us, so the payment window does not ask again. */
export interface PaymentPrefill {
  name?: string;
  email?: string;
  phone?: string;
}

/** Opens the payment provider's window and resolves with what happened in it. */
export abstract class PaymentLauncher {
  abstract open(session: PaymentSession, prefill?: PaymentPrefill): Promise<PaymentOutcome>;
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** The part of Razorpay's Checkout.js that is used here. https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/ */
interface RazorpayCheckout {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error?: { description?: string; reason?: string } }) => void): void;
}
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayCheckout;
  }
}

/**
 * Razorpay's real Checkout window, in test mode with the test keys the server holds (the public key id arrives in the
 * payment session; the secret never leaves the server, which verifies the signature this window returns).
 *
 * A failed attempt is not reported yet: Razorpay keeps its window open on a "try another method" screen (it ignores
 * `close()` there), and a retry inside it can still succeed. The failure is reported only when the shopper closes the
 * window without paying, so a payment made on a second try is never lost. Reporting it releases the order's stock hold,
 * and the page's own "Retry payment" takes it again.
 */
@Injectable({ providedIn: 'root' })
export class RazorpayPaymentLauncher extends PaymentLauncher {
  private script: Promise<void> | null = null;

  /** Loads Checkout.js once per page; a failed load can be tried again. */
  private load(): Promise<void> {
    if (window.Razorpay) return Promise.resolve();
    this.script ??= new Promise<void>((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = CHECKOUT_SCRIPT;
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => {
        tag.remove();
        this.script = null;
        reject(new Error('The payment window could not be loaded.'));
      };
      document.head.appendChild(tag);
    });
    return this.script;
  }

  async open(session: PaymentSession, prefill: PaymentPrefill = {}): Promise<PaymentOutcome> {
    try {
      await this.load();
    } catch {
      return { status: 'failed', reason: 'The payment window could not be loaded' };
    }
    const Razorpay = window.Razorpay;
    if (!Razorpay) return { status: 'failed', reason: 'The payment window could not be loaded' };
    return new Promise<PaymentOutcome>((resolve) => {
      let settled = false;
      let failure: string | null = null;
      const settle = (outcome: PaymentOutcome) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      const checkout = new Razorpay({
        key: session.keyId,
        order_id: session.providerOrderId,
        amount: session.amount,
        currency: session.currency,
        name: 'Shop',
        description: `Order ${session.orderId}`,
        // Razorpay shows the country code separately and only fills the field from the international form.
        prefill: { name: prefill.name, email: prefill.email, contact: /^\d{10}$/.test(prefill.phone ?? '') ? `+91${prefill.phone}` : prefill.phone },
        handler: (response) =>
          settle({
            status: 'success',
            result: { providerOrderId: response.razorpay_order_id, providerPaymentId: response.razorpay_payment_id, signature: response.razorpay_signature },
          }),
        modal: { ondismiss: () => settle(failure === null ? { status: 'dismissed' } : { status: 'failed', reason: failure }) },
      });
      checkout.on('payment.failed', (response) => {
        failure = response.error?.description ?? response.error?.reason ?? 'Payment failed';
      });
      checkout.open();
    });
  }
}

/** Test-mode stand-in: shows an in-page dialog instead of Razorpay. No card data is ever collected. */
@Injectable({ providedIn: 'root' })
export class MockPaymentLauncher extends PaymentLauncher {
  /** Read by `MockRazorpay`. */
  readonly pending = signal<{ session: PaymentSession; resolve: (outcome: PaymentOutcome) => void } | null>(null);

  open(session: PaymentSession): Promise<PaymentOutcome> {
    return new Promise((resolve) => this.pending.set({ session, resolve }));
  }

  succeed(): void {
    const p = this.pending();
    if (!p) return;
    const providerPaymentId = `pay_mock_${Date.now().toString(36)}`;
    this.finish({ status: 'success', result: { providerOrderId: p.session.providerOrderId, providerPaymentId, signature: mockSignature(p.session.providerOrderId, providerPaymentId) } });
  }

  fail(): void {
    this.finish({ status: 'failed', reason: 'Payment declined in test mode' });
  }

  dismiss(): void {
    this.finish({ status: 'dismissed' });
  }

  private finish(outcome: PaymentOutcome): void {
    const p = this.pending();
    this.pending.set(null);
    p?.resolve(outcome);
  }
}

/**
 * What the checkout page uses. The in-browser mock data layer hands out the mock key id, and its orders exist nowhere
 * but this device, so those sessions get the mock dialog; every real backend (Nest, Go, Node, .NET) hands out the
 * Razorpay key it was configured with and gets Razorpay's own window.
 */
@Injectable({ providedIn: 'root' })
export class AutoPaymentLauncher extends PaymentLauncher {
  private readonly mock = inject(MockPaymentLauncher);
  private readonly razorpay = inject(RazorpayPaymentLauncher);

  open(session: PaymentSession, prefill?: PaymentPrefill): Promise<PaymentOutcome> {
    return session.keyId === MOCK_RAZORPAY_KEY_ID ? this.mock.open(session) : this.razorpay.open(session, prefill);
  }
}

/** Mock payment window for test mode. Clearly labelled; it collects no card details. */
export function MockRazorpay() {
  const launcher = useService(MockPaymentLauncher);
  const money = useMoney();
  const pending = useSignal(launcher.pending);
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, !!pending);
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && launcher.dismiss();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, launcher]);
  if (!pending) return null;
  const { session } = pending;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="pay-title" className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-modal">
        <p className="mb-1 inline-block rounded bg-warning px-2 py-0.5 text-xs font-semibold text-on-status">TEST MODE (mock Razorpay)</p>
        <h2 id="pay-title" className="text-lg font-semibold">
          Pay {money({ amount: session.amount, currency: session.currency })}
        </h2>
        <p className="mt-1 text-sm text-text-muted">Order {session.orderId}. No real payment is taken and no card details are needed.</p>
        <div className="mt-4 grid gap-2">
          <Button type="button" onClick={() => launcher.succeed()}>
            Simulate successful payment
          </Button>
          <Button variant="secondary" type="button" onClick={() => launcher.fail()}>
            Simulate failed payment
          </Button>
          <Button variant="ghost" type="button" onClick={() => launcher.dismiss()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
