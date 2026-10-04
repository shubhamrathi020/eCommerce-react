import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { SeoService, safeReturnUrl, useService, useSignal } from '@shop/core';
import { DEMO_ACCOUNTS } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Button, FormError, TextField, rules, useForm } from '@shop/ui';

/** Admin sign in. Accounts without admin permissions are signed straight back out. */
export default function AdminLogin() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const busy = useSignal(auth.busy);
  const [error, setError] = useState('');
  const form = useForm({ email: '', password: '' }, { email: rules.all(rules.required(), rules.email()), password: rules.required() });

  useEffect(() => {
    seo.set({ title: 'Admin sign in', noindex: true });
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
    if (!auth.hasPermission('order:read:any')) {
      await auth.logout();
      setError('This account does not have access to the admin console.');
      return;
    }
    navigate(safeReturnUrl(params.get('returnUrl'), '/'));
  };

  return (
    <div className="mx-auto mt-16 max-w-sm p-4">
      <h1 className="mb-1 text-2xl font-bold">Shop Admin</h1>
      <p className="mb-4 text-sm text-text-muted">Sign in with your staff account.</p>
      <FormError>{error}</FormError>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField form={form} name="email" label="Email" required type="email" autoComplete="username" />
        <TextField form={form} name="password" label="Password" required type="password" autoComplete="current-password" />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      {import.meta.env.DEV && (
        <button type="button" className="mt-6 min-h-11 rounded-md border border-dashed border-border-strong px-3 text-sm text-text-muted" onClick={() => form.patch({ email: DEMO_ACCOUNTS[1].email, password: DEMO_ACCOUNTS[1].password })}>
          Development only: fill demo admin
        </button>
      )}
    </div>
  );
}
