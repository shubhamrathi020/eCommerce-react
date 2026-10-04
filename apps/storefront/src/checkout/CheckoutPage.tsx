import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, type Order, type PaymentMethod, type PaymentOption, type SavedAddress, type ShippingMethodId, type ShippingOption } from '@ecom/contracts';
import { AnalyticsService, SeoService, ToastService, useDate, useMoney, useService, useSignal } from '@shop/core';
import { AddressBookApi, CheckoutApi, OrderApi, PaymentApi } from '@shop/data-access';
import { AuthStore, CartStore } from '@shop/state';
import { Button, CartLine, FormField, OrderSummary, Skeleton, Stepper, cx, inputClass } from '@shop/ui';
import { MockPaymentLauncher, MockRazorpay, type PaymentLauncher } from './payment';

const STEPS = ['Address', 'Delivery', 'Payment', 'Review'];

type FieldName = 'name' | 'email' | 'phone' | 'line1' | 'line2' | 'city' | 'state' | 'pincode';
type Values = Record<FieldName, string>;
const EMPTY: Values = { name: '', email: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

const INVALID_MESSAGES: Partial<Record<FieldName, string>> = { email: 'Enter a valid email address', phone: 'Enter a valid 10-digit mobile number', pincode: 'Enter a valid 6-digit pin code' };

/** The client-side check for each field. The API validates again; this only guides. */
const VALID: Record<FieldName, (v: string) => boolean> = {
  name: (v) => v.trim().length > 0,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone: (v) => /^[6-9]\d{9}$/.test(v),
  line1: (v) => v.trim().length > 0,
  line2: () => true,
  city: (v) => v.trim().length > 0,
  state: (v) => v.trim().length > 0,
  pincode: (v) => /^[1-9]\d{5}$/.test(v),
};

const addressOf = (f: Values) => ({ line1: f.line1.trim(), ...(f.line2.trim() ? { line2: f.line2.trim() } : {}), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode });

/** Four-step guest checkout. Money, stock and coupon rules are always decided by the API. */
export default function CheckoutPage() {
  const store = useService(CartStore);
  const checkout = useService(CheckoutApi);
  const orders = useService(OrderApi);
  const payments = useService(PaymentApi);
  const launcher: PaymentLauncher = useService(MockPaymentLauncher);
  const analytics = useService(AnalyticsService);
  const seo = useService(SeoService);
  const toast = useService(ToastService);
  const auth = useService(AuthStore);
  const book = useService(AddressBookApi);
  const navigate = useNavigate();
  const money = useMoney();
  const date = useDate();

  const loaded = useSignal(store.loaded);
  const cart = useSignal(store.cart);
  const loggedIn = useSignal(auth.loggedIn);

  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [selectedSaved, setSelectedSaved] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Set<FieldName>>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('razorpay');
  const [payError, setPayError] = useState('');
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});

  const newKey = () => {
    idempotencyKey.current = crypto.randomUUID();
    setPendingOrder(null);
  };

  useEffect(() => {
    seo.set({ title: 'Checkout', noindex: true, path: '/checkout' });
    analytics.track({ name: 'checkout_start' });
  }, [seo, analytics]);

  // Signed-in customers get their details and default address filled in.
  useEffect(() => {
    let current = true;
    (async () => {
      await auth.init();
      const user = auth.user();
      if (!user || !current) return;
      setValues((v) => ({ ...v, name: user.name, email: user.email, phone: user.phone ?? '' }));
      try {
        const list = await firstValueFrom(book.list());
        if (!current) return;
        setSaved(list);
        const fallback = list.find((a) => a.isDefault);
        if (fallback) pickSaved(fallback.id, list);
      } catch {
        // Checkout still works without saved addresses.
      }
    })();
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, book]);

  // Move keyboard focus to the new step's heading so screen-reader users know the page changed.
  useEffect(() => {
    const id = setTimeout(() => document.getElementById('step-heading')?.focus(), 0);
    return () => clearTimeout(id);
  }, [step]);

  const set = (name: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const blur = (name: FieldName) => () => setTouched((s) => new Set(s).add(name));

  const pickSaved = (id: string, list = saved) => {
    setSelectedSaved(id);
    const a = list.find((x) => x.id === id);
    if (!a) {
      setValues((v) => ({ ...v, line1: '', line2: '', city: '', state: '', pincode: '' }));
      return;
    }
    setValues((v) => ({ ...v, name: a.name, phone: a.phone, line1: a.address.line1, line2: a.address.line2 ?? '', city: a.address.city, state: a.address.state, pincode: a.address.pincode }));
  };

  const err = (name: FieldName): string => {
    if (serverErrors[name]) return serverErrors[name];
    if (!touched.has(name) || VALID[name](values[name])) return '';
    return values[name].trim() ? (INVALID_MESSAGES[name] ?? 'Enter a valid value') : 'This field is required';
  };

  const go = (next: number) => {
    if (next < 3) newKey();
    setPayError('');
    setStep(next);
  };

  const continueFromAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerErrors({});
    setTouched(new Set(Object.keys(EMPTY) as FieldName[]));
    const firstInvalid = (Object.keys(EMPTY) as FieldName[]).find((k) => !VALID[k](values[k]));
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    setBusy(true);
    try {
      setShippingOptions(await firstValueFrom(checkout.shippingOptions(values.pincode)));
      go(1);
    } catch (error) {
      setServerErrors({ pincode: error instanceof ApiException ? error.message : 'Could not check delivery. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const continueFromDelivery = async () => {
    setBusy(true);
    try {
      const options = await firstValueFrom(checkout.paymentOptions(values.pincode));
      setPaymentOptions(options);
      // Keep the choice valid if COD stopped being available (e.g. total rose after picking express).
      if (!options.find((o) => o.method === method)?.enabled) setMethod('razorpay');
      go(2);
    } catch (error) {
      toast.error(error instanceof ApiException ? error.message : 'Could not load payment options.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (order: Order) => {
    if (loggedIn && saveAddress && !selectedSaved) {
      try {
        await firstValueFrom(book.add({ label: `Address ${saved.length + 1}`, name: values.name.trim(), phone: values.phone, address: addressOf(values) }));
      } catch {
        // Saving the address is a convenience; the order already succeeded.
      }
    }
    // One purchase event per product, grouped by order so "bought together" can be counted. No customer details.
    for (const line of order.lines) analytics.track({ name: 'purchase', props: { productId: line.productId, quantity: line.quantity, orderId: order.id } });
    await store.refresh();
    toast.success(`Order placed. A confirmation was sent to ${order.contact.email}.`);
    navigate(`/orders/${order.id}?placed=1`);
  };

  const pay = async (orderId: string) => {
    analytics.track({ name: 'payment_start' });
    const session = await firstValueFrom(payments.initiate(orderId));
    const outcome = await launcher.open(session);
    if (outcome.status === 'success') {
      await finish(await firstValueFrom(payments.confirm(orderId, outcome.result)));
    } else if (outcome.status === 'failed') {
      await firstValueFrom(payments.fail(orderId, outcome.reason));
      setPayError('Your payment did not go through. You can retry or choose another payment method.');
    } else {
      setPayError('Payment was cancelled. Your order is saved; you can retry when ready.');
    }
  };

  const placeOrder = async () => {
    if (busy) return;
    setBusy(true);
    setPayError('');
    try {
      const order = await firstValueFrom(
        orders.place({
          idempotencyKey: idempotencyKey.current,
          contact: { name: values.name.trim(), email: values.email.trim(), phone: values.phone },
          address: addressOf(values),
          paymentMethod: method,
        }),
      );
      // Cash on delivery, or a gift card / store credit that covered the whole order: nothing to pay online.
      if (order.paymentMethod === 'cod' || order.status === 'confirmed') {
        await finish(order);
        return;
      }
      setPendingOrder(order);
      await pay(order.id);
    } catch (error) {
      if (error instanceof ApiException && error.fields) {
        setServerErrors(error.fields);
        setStep(0);
      }
      setPayError(error instanceof ApiException ? error.message : 'We could not place your order. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const retryPayment = async (orderId: string) => {
    setBusy(true);
    setPayError('');
    try {
      await pay(orderId);
    } catch (error) {
      setPayError(error instanceof ApiException ? error.message : 'Payment could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Abandons the pending online order so the shopper can pick, for example, cash on delivery. */
  const switchMethod = () => {
    newKey();
    setPayError('');
    setStep(2);
  };

  const text = (name: FieldName, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> & { span?: boolean; hint?: string; optional?: boolean } = {}) => {
    const { span, hint, optional, ...input } = extra;
    const error = err(name);
    return (
      <div className={cx(span && 'md:col-span-2')}>
        <FormField label={label} required={!optional} error={error} hint={hint}>
          {(f) => <input id={f.id} className={inputClass} ref={(el) => { fieldRefs.current[name] = el; }} value={values[name]} onChange={set(name)} onBlur={blur(name)} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} {...input} />}
        </FormField>
      </div>
    );
  };

  return (
    <>
      <h1 className="mb-3 text-2xl font-bold md:text-3xl">Checkout</h1>
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>
      {!loaded || !cart ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <section aria-live="polite">
            <h2 id="step-heading" tabIndex={-1} className="mb-4 text-xl font-semibold outline-none">
              {STEPS[step]}
            </h2>

            {step === 0 && (
              <>
                {saved.length > 0 && (
                  <div className="mb-4">
                    <label htmlFor="saved-address" className="mb-1 block text-sm font-medium">
                      Deliver to a saved address
                    </label>
                    <select id="saved-address" className={inputClass} value={selectedSaved} onChange={(e) => pickSaved(e.target.value)}>
                      <option value="">Enter a new address</option>
                      {saved.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}: {a.address.line1}, {a.address.city} {a.address.pincode}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <form onSubmit={continueFromAddress} noValidate className="grid gap-4 md:grid-cols-2">
                  {text('name', 'Full name', { autoComplete: 'name' })}
                  {text('email', 'Email', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
                  {text('phone', 'Mobile number', { type: 'tel', autoComplete: 'tel-national', inputMode: 'numeric', maxLength: 10, hint: '10 digits' })}
                  {text('pincode', 'Pin code', { autoComplete: 'postal-code', inputMode: 'numeric', maxLength: 6 })}
                  {text('line1', 'Address line 1', { autoComplete: 'address-line1', span: true })}
                  {text('line2', 'Address line 2 (optional)', { autoComplete: 'address-line2', span: true, optional: true })}
                  {text('city', 'City', { autoComplete: 'address-level2' })}
                  {text('state', 'State', { autoComplete: 'address-level1' })}
                  {loggedIn && !selectedSaved && (
                    <label className="flex min-h-11 items-center gap-2 text-sm md:col-span-2">
                      <input type="checkbox" className="size-5 accent-primary" checked={saveAddress} onChange={() => setSaveAddress(!saveAddress)} /> Save this address to my account
                    </label>
                  )}
                  <div className="md:col-span-2">
                    <Button type="submit" loading={busy}>
                      Continue to delivery
                    </Button>
                  </div>
                </form>
              </>
            )}

            {step === 1 && (
              <>
                <fieldset className="space-y-3">
                  <legend className="sr-only">Delivery speed</legend>
                  {shippingOptions.map((option) => (
                    <label key={option.id} className={cx('flex cursor-pointer items-center gap-3 rounded-lg border p-4', cart.shippingMethod === option.id ? 'border-primary' : 'border-border')}>
                      <input type="radio" name="shipping" className="size-5 accent-primary" checked={cart.shippingMethod === option.id} onChange={() => void store.setShippingMethod(option.id as ShippingMethodId)} />
                      <span className="flex-1">
                        <span className="block font-medium">{option.label}</span>
                        <span className="block text-sm text-text-muted">Delivery by {date(option.estimatedDate, 'EEE, d MMM')}</span>
                      </span>
                      <span className="font-semibold">{option.price.amount === 0 ? 'Free' : money(option.price)}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" type="button" onClick={() => go(0)}>
                    Back
                  </Button>
                  <Button type="button" loading={busy} onClick={() => void continueFromDelivery()}>
                    Continue to payment
                  </Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <fieldset className="space-y-3">
                  <legend className="sr-only">Payment method</legend>
                  {paymentOptions.map((option) => (
                    <label key={option.method} className={cx('flex items-start gap-3 rounded-lg border p-4', method === option.method ? 'border-primary' : 'border-border', option.enabled ? 'cursor-pointer' : 'opacity-60')}>
                      <input
                        type="radio"
                        name="payment"
                        className="mt-1 size-5 accent-primary"
                        checked={method === option.method}
                        disabled={!option.enabled}
                        aria-describedby={option.reason ? `reason-${option.method}` : undefined}
                        onChange={() => {
                          setMethod(option.method);
                          newKey();
                        }}
                      />
                      <span>
                        <span className="block font-medium">{option.label}</span>
                        {option.reason && (
                          <span className="block text-sm text-text-muted" id={`reason-${option.method}`}>
                            {option.reason}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" type="button" onClick={() => go(1)}>
                    Back
                  </Button>
                  <Button type="button" onClick={() => go(3)}>
                    Review order
                  </Button>
                </div>
              </>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <section className="rounded-lg border border-border p-4" aria-label="Delivery address">
                  <p className="flex justify-between font-medium">
                    Deliver to{' '}
                    <button type="button" className="min-h-11 text-sm text-primary hover:underline" onClick={() => go(0)}>
                      Change
                    </button>
                  </p>
                  <p className="text-sm">
                    {values.name}, {values.phone}
                  </p>
                  <p className="text-sm text-text-muted">
                    {values.line1}, {values.line2} {values.city}, {values.state} {values.pincode}
                  </p>
                </section>
                <section className="rounded-lg border border-border p-4" aria-label="Payment">
                  <p className="flex justify-between font-medium">
                    Payment{' '}
                    <button type="button" className="min-h-11 text-sm text-primary hover:underline" onClick={() => go(2)}>
                      Change
                    </button>
                  </p>
                  <p className="text-sm text-text-muted">{method === 'cod' ? 'Cash on delivery' : 'Pay online with Razorpay (test mode)'}</p>
                </section>
                <ul className="divide-y divide-border rounded-lg border border-border px-4" aria-label="Items">
                  {cart.lines.map((line) => (
                    <li key={line.variantId} className="py-3">
                      <CartLine line={line} compact editable={false} />
                    </li>
                  ))}
                </ul>
                {payError && (
                  <div className="rounded-md border border-danger p-3 text-sm" role="alert">
                    <p>{payError}</p>
                    {pendingOrder && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" type="button" loading={busy} onClick={() => void retryPayment(pendingOrder.id)}>
                          Retry payment
                        </Button>
                        <Button size="sm" variant="secondary" type="button" onClick={switchMethod}>
                          Choose another method
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" type="button" onClick={() => go(2)}>
                    Back
                  </Button>
                  <Button type="button" loading={busy} disabled={!!pendingOrder} onClick={() => void placeOrder()}>
                    {method === 'cod' ? 'Place order' : `Pay ${money(cart.totals.total)}`}
                  </Button>
                </div>
              </div>
            )}
          </section>
          <aside className="h-fit rounded-lg border border-border p-4" aria-label="Order summary">
            <h2 className="mb-3 font-semibold">Order summary</h2>
            <OrderSummary totals={cart.totals} coupon={cart.coupon} promotions={cart.promotions} />
            <Link to="/cart" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
              Edit cart
            </Link>
          </aside>
        </div>
      )}
      <MockRazorpay />
    </>
  );
}
