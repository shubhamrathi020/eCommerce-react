import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, SELLER_STATUS_LABEL, type SellerApplicationInput } from '@ecom/contracts';
import { SeoService, ToastService, safeReturnUrl, useMoney, useResource, useService, useSignal } from '@shop/core';
import { DEMO_ACCOUNTS, SellerPortalApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, ButtonLink, ErrorState, FormError, FormField, PASSWORD_HINT, Skeleton, TextField, ThemeToggle, ToastContainer, cx, inputClass, rules, useForm } from '@shop/ui';

const NAV = [
  { label: 'Overview', link: '/', exact: true, portal: false },
  { label: 'Products', link: '/products', exact: false, portal: true },
  { label: 'Orders', link: '/orders', exact: false, portal: true },
  { label: 'Payouts', link: '/payouts', exact: false, portal: true },
];

/** The seller portal frame. Working pages are listed only for accounts that have been approved to sell. */
export function SellerShell() {
  const auth = useService(AuthStore);
  const navigate = useNavigate();
  const user = useSignal(auth.user);
  const permissions = useSignal(auth.permissions);
  const items = NAV.filter((n) => !n.portal || permissions.includes('seller:portal'));
  return (
    <>
      <a href="#seller-main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:start-2 focus:top-2">
        Skip to main content
      </a>
      <div className="flex min-h-screen flex-col md:flex-row">
        <nav aria-label="Seller portal" className="border-b border-border bg-surface-alt p-3 md:w-56 md:shrink-0 md:border-b-0 md:border-e md:p-4">
          <p className="mb-2 text-lg font-bold text-primary md:mb-4">Seller Centre</p>
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {items.map((item) => (
              <li key={item.link}>
                <NavLink to={item.link} end={item.exact} className={({ isActive }) => cx('flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-border', isActive && 'bg-primary text-primary-contrast')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-border pt-3 text-sm">
            <p className="truncate text-text-muted">{user?.name}</p>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={async () => {
                await auth.logout();
                navigate('/login');
              }}
            >
              Sign out
            </Button>
          </div>
        </nav>
        <main id="seller-main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
    </>
  );
}

/** Sign in. Any account may sign in; the portal shows what that account can do (apply, wait, or work). */
export function SellerLogin() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const busy = useSignal(auth.busy);
  const [error, setError] = useState('');
  const form = useForm({ email: '', password: '' }, { email: rules.all(rules.required(), rules.email()), password: rules.required() });
  useEffect(() => {
    seo.set({ title: 'Seller sign in', noindex: true });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.validate()) return;
    const result = await auth.login(form.values.email, form.values.password);
    if (!result.ok) {
      setError(result.message ?? 'Could not sign in.');
      return;
    }
    navigate(safeReturnUrl(params.get('returnUrl'), '/'));
  };

  return (
    <div className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-1 text-2xl font-bold">Seller Centre</h1>
      <p className="mb-4 text-sm text-text-muted">Sign in to manage your store, or create an account to apply to sell.</p>
      <FormError>{error}</FormError>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField form={form} name="email" label="Email" required type="email" autoComplete="username" />
        <TextField form={form} name="password" label="Password" required type="password" autoComplete="current-password" />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm">
        New here?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create an account to sell
        </Link>
      </p>
      {import.meta.env.DEV && (
        <button type="button" className="mt-6 min-h-11 rounded-md border border-dashed border-border-strong px-3 text-sm text-text-muted" onClick={() => form.patch({ email: DEMO_ACCOUNTS[2].email, password: DEMO_ACCOUNTS[2].password })}>
          Development only: fill demo seller
        </button>
      )}
    </div>
  );
}

/** Creates a customer account, which can then apply to sell. */
export function SellerRegister() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const busy = useSignal(auth.busy);
  const [error, setError] = useState('');
  const form = useForm({ name: '', email: '', password: '' }, { name: rules.required(), email: rules.all(rules.required(), rules.email()), password: rules.all(rules.required(), rules.minLength(8)) });
  useEffect(() => {
    seo.set({ title: 'Create a seller account', noindex: true });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.validate()) return;
    const result = await auth.register(form.values);
    if (!result.ok) {
      setError(result.message ?? 'Could not create the account.');
      return;
    }
    navigate('/apply');
  };

  return (
    <div className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-1 text-2xl font-bold">Create your account</h1>
      <p className="mb-4 text-sm text-text-muted">You will then be asked for your business details. An administrator reviews every application.</p>
      <FormError>{error}</FormError>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField form={form} name="name" label="Full name" required autoComplete="name" />
        <TextField form={form} name="email" label="Email" required type="email" autoComplete="email" />
        <TextField form={form} name="password" label="Password" required hint={PASSWORD_HINT} type="password" autoComplete="new-password" />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

type Field = 'displayName' | 'legalName' | 'phone' | 'gstin' | 'pan' | 'address.line1' | 'address.city' | 'address.state' | 'address.pincode' | 'bankHolder' | 'bankAccountNumber' | 'bankIfsc' | 'policies.returns' | 'policies.shipping';
interface FieldDef {
  key: Field;
  label: string;
  hint?: string;
  auto?: string;
  mode?: 'numeric';
}

const STORE_FIELDS: FieldDef[] = [
  { key: 'displayName', label: 'Store name', hint: 'Shown to shoppers' },
  { key: 'legalName', label: 'Legal business name' },
  { key: 'phone', label: 'Mobile number', mode: 'numeric', auto: 'tel-national' },
  { key: 'gstin', label: 'GSTIN', hint: '15 characters, for example 27AAAPL1234C1ZV' },
  { key: 'pan', label: 'PAN', hint: '10 characters, for example AAAPL1234C' },
];
const ADDRESS_FIELDS: FieldDef[] = [
  { key: 'address.line1', label: 'Address' },
  { key: 'address.city', label: 'City' },
  { key: 'address.state', label: 'State' },
  { key: 'address.pincode', label: 'Pin code', mode: 'numeric' },
];
const BANK_FIELDS: FieldDef[] = [
  { key: 'bankHolder', label: 'Account holder name' },
  { key: 'bankAccountNumber', label: 'Account number', mode: 'numeric', hint: 'Only the last four digits are kept' },
  { key: 'bankIfsc', label: 'IFSC code', hint: 'For example HDFC0001234' },
];
const POLICY_FIELDS: FieldDef[] = [
  { key: 'policies.returns', label: 'Returns policy' },
  { key: 'policies.shipping', label: 'Shipping policy' },
];

/** Seller application with KYC fields. An administrator reviews it; a rejected applicant sees the reason and can apply again. */
export function ApplyPage() {
  const api = useService(SellerPortalApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const me = useResource(() => api.me(), [api]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Apply to sell', noindex: true });
  }, [seo]);

  const seller = me.value ?? null;
  /** Why this account cannot apply right now, if it cannot. */
  const blocked = !me.value && me.loading ? '' : !seller || seller.status === 'rejected' ? '' : seller.status === 'pending' ? 'Your application is being reviewed. We will email you when it is decided.' : 'You already have a store.';

  const build = (): SellerApplicationInput => {
    const g = (k: Field) => values[k] ?? '';
    return {
      displayName: g('displayName'),
      legalName: g('legalName'),
      phone: g('phone'),
      gstin: g('gstin'),
      pan: g('pan'),
      address: { line1: g('address.line1'), city: g('address.city'), state: g('address.state'), pincode: g('address.pincode') },
      bankHolder: g('bankHolder'),
      bankAccountNumber: g('bankAccountNumber'),
      bankIfsc: g('bankIfsc'),
      policies: { returns: g('policies.returns'), shipping: g('policies.shipping') },
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);
    try {
      await firstValueFrom(api.apply(build()));
      toast.success('Application sent. We will review it shortly.');
      navigate('/');
    } catch (err) {
      if (err instanceof ApiException) {
        setErrors(err.fields ?? {});
        setFormError(err.fields ? 'Please check the highlighted fields.' : err.message);
      } else setFormError('Could not send your application. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const field = (f: FieldDef, area = false) => (
    <FormField key={f.key} label={f.label} required hint={f.hint ?? ''} error={errors[f.key] ?? ''}>
      {(ids) =>
        area ? (
          <textarea id={ids.id} className={inputClass} rows={2} aria-describedby={ids.describedBy} aria-invalid={errors[f.key] ? 'true' : undefined} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        ) : (
          <input id={ids.id} className={inputClass} autoComplete={f.auto ?? 'off'} inputMode={f.mode} aria-describedby={ids.describedBy} aria-invalid={errors[f.key] ? 'true' : undefined} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        )
      }
    </FormField>
  );

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Apply to sell</h1>
      {me.loading && !me.value && me.status === 'loading' ? (
        <Skeleton className="h-64 max-w-2xl" />
      ) : blocked ? (
        <p className="max-w-2xl rounded-lg border border-border p-4" role="status">
          {blocked}{' '}
          <Link to="/" className="text-primary underline">
            Back to the overview
          </Link>
        </p>
      ) : (
        <>
          <p className="mb-4 max-w-2xl text-sm text-text-muted">Tell us about your business. We check these details before you can list products. Your bank account number is used for payouts only and we keep just its last four digits.</p>
          {seller?.status === 'rejected' && (
            <p className="mb-4 max-w-2xl rounded-lg border border-danger p-3 text-sm" role="alert">
              Your earlier application was not approved: {seller.rejectionReason}. Fix the details and apply again.
            </p>
          )}
          <form className="max-w-2xl space-y-6" onSubmit={submit} noValidate>
            <fieldset className="space-y-4">
              <legend className="mb-1 text-lg font-semibold">Your store</legend>
              {STORE_FIELDS.map((f) => field(f))}
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="mb-1 text-lg font-semibold">Pickup address</legend>
              {ADDRESS_FIELDS.map((f) => field(f))}
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="mb-1 text-lg font-semibold">Payout account</legend>
              {BANK_FIELDS.map((f) => field(f))}
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="mb-1 text-lg font-semibold">Policies shoppers will see</legend>
              {POLICY_FIELDS.map((f) => field(f, true))}
            </fieldset>
            {formError && (
              <p className="text-sm text-danger" role="alert">
                {formError}
              </p>
            )}
            <Button type="submit" loading={saving}>
              Submit application
            </Button>
          </form>
        </>
      )}
    </>
  );
}

/** The first screen: what state the account is in (not applied, waiting, rejected with the reason, suspended) or, once approved, the day's work. */
export function SellerDashboard() {
  const api = useService(SellerPortalApi);
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const money = useMoney();
  const me = useResource(() => api.me(), [api]);
  const canWork = useSignal(auth.permissions).includes('seller:portal');
  const s = me.value;
  const approved = canWork && !!s && s.status === 'approved';

  /** The day's counts, only asked for once the account can work (the API refuses everything else). */
  const stats = useResource(
    async () => {
      const [products, shipments, payouts] = await Promise.all([firstValueFrom(api.products()), firstValueFrom(api.shipments()), firstValueFrom(api.payouts())]);
      return {
        live: products.filter((p) => p.status === 'approved').length,
        pending: products.filter((p) => p.status === 'pending').length,
        rejected: products.filter((p) => p.status === 'rejected').length,
        toPack: shipments.filter((x) => x.status === 'confirmed').length,
        toShip: shipments.filter((x) => x.status === 'packed').length,
        upcomingNet: payouts.upcoming.net,
      };
    },
    [api, approved],
    approved,
  );
  useEffect(() => {
    seo.set({ title: 'Seller overview', noindex: true });
  }, [seo]);

  const st = stats.value;
  const tile = (label: string, value: number) => (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Overview</h1>
      {me.status === 'ready' ? (
        !s ? (
          <section className="max-w-2xl rounded-lg border border-border p-4">
            <h2 className="font-semibold">Start selling</h2>
            <p className="mb-3 text-sm text-text-muted">Apply with your business details. Once an administrator approves you, you can list products and receive orders.</p>
            <ButtonLink to="/apply">Apply to sell</ButtonLink>
          </section>
        ) : (
          <>
            <p className="mb-4 text-sm">
              {s.displayName} <Badge tone={s.status === 'approved' ? 'success' : s.status === 'pending' ? 'warning' : 'danger'}>{SELLER_STATUS_LABEL[s.status]}</Badge>
            </p>
            {s.status === 'pending' && (
              <p className="max-w-2xl rounded-lg border border-border p-4" role="status">
                Your application is being reviewed. We will email you when it is decided; sign in again after that.
              </p>
            )}
            {s.status === 'rejected' && (
              <section className="max-w-2xl rounded-lg border border-danger p-4" role="status">
                <h2 className="font-semibold">Your application was not approved</h2>
                <p className="mb-3 text-sm">{s.rejectionReason}</p>
                <ButtonLink to="/apply">Fix the details and apply again</ButtonLink>
              </section>
            )}
            {s.status === 'suspended' && (
              <p className="max-w-2xl rounded-lg border border-danger p-4" role="alert">
                Your store is suspended and your listings are off sale. Contact the marketplace team.
              </p>
            )}
            {s.status === 'approved' &&
              (!canWork ? (
                <p className="max-w-2xl rounded-lg border border-warning p-4" role="status">
                  You are approved. Sign out and sign in again to open your portal.
                </p>
              ) : st ? (
                <>
                  <dl className="grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4" aria-label="Today">
                    {tile('Live listings', st.live)}
                    {tile('Awaiting approval', st.pending)}
                    {tile('To pack', st.toPack)}
                    {tile('To ship', st.toShip)}
                  </dl>
                  <p className="mt-4 text-sm">
                    Next payout, if issued now: <strong>{money({ amount: st.upcomingNet, currency: 'INR' })}</strong> after commission.
                  </p>
                  {st.rejected > 0 && (
                    <p className="mt-2 text-sm text-danger" role="status">
                      {st.rejected} listing(s) were not approved.{' '}
                      <Link to="/products" className="underline">
                        See why
                      </Link>
                      .
                    </p>
                  )}
                </>
              ) : stats.status === 'error' ? (
                <ErrorState onRetry={stats.reload} />
              ) : (
                <Skeleton className="h-24 max-w-3xl" />
              ))}
          </>
        )
      ) : me.status === 'error' ? (
        <ErrorState onRetry={me.reload} />
      ) : (
        <Skeleton className="h-24 max-w-2xl" />
      )}
    </>
  );
}
