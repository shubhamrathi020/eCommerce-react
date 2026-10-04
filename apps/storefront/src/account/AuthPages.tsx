import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException } from '@ecom/contracts';
import { SeoService, safeReturnUrl, useService, useSignal } from '@shop/core';
import { AuthApi, DEMO_ACCOUNTS } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Button, ButtonLink, FormError, PASSWORD_HINT, Skeleton, TextField, rules, useForm } from '@shop/ui';

function useReturnUrl(): string | undefined {
  const [params] = useSearchParams();
  return params.get('returnUrl') ?? undefined;
}

function ShowPassword({ show, onChange }: { show: boolean; onChange: (show: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className="size-5 accent-primary" checked={show} onChange={() => onChange(!show)} /> Show password
    </label>
  );
}

export function LoginPage() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const returnUrl = useReturnUrl();
  const busy = useSignal(auth.busy);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const form = useForm({ email: '', password: '' }, { email: rules.all(rules.required('Enter your email address'), rules.email()), password: rules.required('Enter your password') });

  useEffect(() => {
    seo.set({ title: 'Sign in', noindex: true, path: '/account/login' });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.validate()) return;
    const result = await auth.login(form.values.email, form.values.password);
    if (result.ok) navigate(safeReturnUrl(returnUrl));
    else setError(result.message ?? 'Could not sign in.');
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Sign in</h1>
      <FormError>{error}</FormError>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField form={form} name="email" label="Email" required type="email" autoComplete="username" inputMode="email" />
        <TextField form={form} name="password" label="Password" required type={show ? 'text' : 'password'} autoComplete="current-password" />
        <ShowPassword show={show} onChange={setShow} />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/account/forgot-password" className="text-primary hover:underline">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-sm">
        New here?{' '}
        <Link to={returnUrl ? `/account/register?returnUrl=${encodeURIComponent(returnUrl)}` : '/account/register'} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      {import.meta.env.DEV && (
        <button type="button" className="mt-6 min-h-11 rounded-md border border-dashed border-border-strong px-3 text-sm text-text-muted" onClick={() => form.patch({ email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password })}>
          Development only: fill demo customer
        </button>
      )}
    </div>
  );
}

export function RegisterPage() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const returnUrl = useReturnUrl();
  const busy = useSignal(auth.busy);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const form = useForm(
    { name: '', email: '', password: '' },
    { name: rules.required(), email: rules.all(rules.required(), rules.email()), password: rules.all(rules.required(), rules.minLength(8)) },
  );

  useEffect(() => {
    seo.set({ title: 'Create account', noindex: true, path: '/account/register' });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.validate()) return;
    const result = await auth.register(form.values);
    if (result.ok) {
      navigate(safeReturnUrl(returnUrl));
      return;
    }
    form.setServerErrors(result.fields ?? {});
    setError(result.message ?? 'Could not create the account.');
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Create your account</h1>
      <FormError>{error}</FormError>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField form={form} name="name" label="Full name" required autoComplete="name" />
        <TextField form={form} name="email" label="Email" required type="email" autoComplete="email" inputMode="email" />
        <TextField form={form} name="password" label="Password" required hint={PASSWORD_HINT} type={show ? 'text' : 'password'} autoComplete="new-password" />
        <ShowPassword show={show} onChange={setShow} />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link to={returnUrl ? `/account/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/account/login'} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

/** Asks for an email and always shows the same confirmation, so nobody can probe which emails have accounts. */
export function ForgotPasswordPage() {
  const api = useService(AuthApi);
  const seo = useService(SeoService);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({ email: '' }, { email: rules.all(rules.required('Enter your email address'), rules.email()) });
  useEffect(() => {
    seo.set({ title: 'Forgot password', noindex: true, path: '/account/forgot-password' });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.validate()) return;
    setBusy(true);
    try {
      await firstValueFrom(api.requestPasswordReset(form.values.email));
    } catch {
      // Same answer either way.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Forgot your password?</h1>
      {sent ? (
        <>
          <p className="rounded-md border border-success p-3 text-sm" role="status">
            If an account exists for that email, we have sent a link to reset your password. It works for 30 minutes.
          </p>
          {import.meta.env.DEV && (
            <p className="mt-3 text-sm text-text-muted">
              Development only: no real email is sent.{' '}
              <Link to="/dev/mailbox" className="text-primary underline">
                Open the demo mailbox
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField form={form} name="email" label="Email" required type="email" autoComplete="email" inputMode="email" />
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/account/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const api = useService(AuthApi);
  const seo = useService(SeoService);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const form = useForm({ password: '' }, { password: rules.all(rules.required(), rules.minLength(8)) });
  useEffect(() => {
    seo.set({ title: 'Reset password', noindex: true, path: '/account/reset-password' });
  }, [seo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.validate()) return;
    setBusy(true);
    try {
      await firstValueFrom(api.resetPassword(token, form.values.password));
      setDone(true);
    } catch (err) {
      const message = err instanceof ApiException ? err.message : 'Could not reset the password.';
      if (err instanceof ApiException && err.fields?.['password']) form.setServerErrors({ password: message });
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Choose a new password</h1>
      {done ? (
        <>
          <p className="rounded-md border border-success p-3 text-sm" role="status">
            Your password was changed. You can now sign in.
          </p>
          <ButtonLink to="/account/login" className="mt-4">
            Sign in
          </ButtonLink>
        </>
      ) : (
        <>
          <FormError>{error}</FormError>
          <form onSubmit={submit} noValidate className="space-y-4">
            <TextField form={form} name="password" label="New password" required hint={PASSWORD_HINT} type="password" autoComplete="new-password" />
            <Button type="submit" className="w-full" loading={busy}>
              Change password
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const api = useService(AuthApi);
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const [status, setStatus] = useState<'working' | 'ok' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    seo.set({ title: 'Verify email', noindex: true, path: '/account/verify-email' });
  }, [seo]);

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        await firstValueFrom(api.verifyEmail(token));
        await auth.refresh();
        if (current) setStatus('ok');
      } catch (e) {
        if (!current) return;
        setMessage(e instanceof ApiException ? e.message : 'We could not verify your email.');
        setStatus('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [api, auth, token]);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Verify your email</h1>
      {status === 'working' ? (
        <Skeleton className="h-12" />
      ) : status === 'ok' ? (
        <>
          <p className="rounded-md border border-success p-3 text-sm" role="status">
            Your email address is verified. Thank you!
          </p>
          <ButtonLink to="/account" className="mt-4">
            Go to my account
          </ButtonLink>
        </>
      ) : (
        <p className="rounded-md border border-danger p-3 text-sm" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
