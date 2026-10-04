import { useEffect, useRef } from 'react';
import type { PaymentResult, PaymentSession } from '@ecom/contracts';
import { Injectable, signal, useMoney, useService, useSignal } from '@shop/core';
import { mockSignature } from '@shop/data-access';
import { Button, useFocusTrap } from '@shop/ui';

export type PaymentOutcome = { status: 'success'; result: PaymentResult } | { status: 'failed'; reason: string } | { status: 'dismissed' };

/**
 * Opens the payment provider's window. The real Razorpay adapter will load their checkout script and resolve with the same
 * outcome shape; the checkout page does not change.
 */
export abstract class PaymentLauncher {
  abstract open(session: PaymentSession): Promise<PaymentOutcome>;
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
