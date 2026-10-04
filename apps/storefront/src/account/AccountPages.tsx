import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException } from '@ecom/contracts';
import { SeoService, ToastService, useDate, useService, useSignal } from '@shop/core';
import { AuthApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Button, PASSWORD_HINT, TextField, rules, useForm } from '@shop/ui';

const TILES = [
  { title: 'Orders', text: 'Track, cancel and view invoices', link: '/orders' },
  { title: 'Returns and refunds', text: 'Request a return and follow your refund', link: '/account/returns' },
  { title: 'Help and support', text: 'Ask us about an order', link: '/account/support' },
  { title: 'Wishlist', text: 'Products you saved', link: '/wishlist' },
  { title: 'Addresses', text: 'Manage delivery addresses', link: '/account/addresses' },
  { title: 'Notifications', text: 'Order, review and price alerts', link: '/notifications' },
  { title: 'Notification preferences', text: 'Choose what we send you', link: '/account/preferences' },
  { title: 'Your alerts', text: 'Products you asked to be told about', link: '/account/alerts' },
  { title: 'Profile and password', text: 'Update your details', link: '/account/profile' },
  { title: 'Privacy', text: 'Export or delete your data', link: '/account/privacy' },
  { title: 'Personalisation', text: 'Control recommendations and activity tracking', link: '/personalisation' },
];

export function AccountHome() {
  const auth = useService(AuthStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const date = useDate();
  const user = useSignal(auth.user);
  useEffect(() => {
    seo.set({ title: 'My account', noindex: true, path: '/account' });
  }, [seo]);
  if (!user) return null;
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Hello, {user.name}</h1>
      <p className="mb-4 text-sm text-text-muted">
        {user.email} · member since {date(user.createdAt, 'MMM y')}
      </p>

      {!user.emailVerified && (
        <div className="mb-4 rounded-lg border border-warning p-4 text-sm" role="status">
          <p className="font-medium">Please verify your email address.</p>
          <p className="text-text-muted">
            We sent you a link when you registered.
            {import.meta.env.DEV && (
              <Link to="/dev/mailbox" className="ms-1 text-primary underline">
                Development only: open the demo mailbox
              </Link>
            )}
          </p>
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {TILES.map((tile) => (
          <li key={tile.link}>
            <Link to={tile.link} className="block rounded-lg border border-border p-4 hover:bg-surface-alt">
              <span className="block font-semibold">{tile.title}</span>
              <span className="text-sm text-text-muted">{tile.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        type="button"
        className="mt-6"
        onClick={async () => {
          await auth.logout();
          navigate('/');
        }}
      >
        Sign out
      </Button>
    </>
  );
}

export function ProfilePage() {
  const auth = useService(AuthStore);
  const api = useService(AuthApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const user = useSignal(auth.user);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const profile = useForm({ name: '', phone: '' }, { name: rules.required(), phone: rules.pattern(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number') });
  const password = useForm({ currentPassword: '', newPassword: '' }, { currentPassword: rules.required(), newPassword: rules.all(rules.required(), rules.minLength(8)) });

  useEffect(() => {
    seo.set({ title: 'Profile', noindex: true, path: '/account/profile' });
  }, [seo]);

  const userId = user?.id;
  useEffect(() => {
    if (user) profile.patch({ name: user.name, phone: user.phone ?? '' });
    // Fill the form once per user, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.validate()) return;
    setSavingProfile(true);
    try {
      const { name, phone } = profile.values;
      await firstValueFrom(api.updateProfile({ name, ...(phone ? { phone } : {}) }));
      await auth.refresh();
      toast.success('Profile updated');
    } catch (err) {
      if (err instanceof ApiException && err.fields) profile.setServerErrors(err.fields);
      else toast.error('Could not update your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.validate()) return;
    setSavingPassword(true);
    try {
      await firstValueFrom(api.changePassword(password.values.currentPassword, password.values.newPassword));
      password.reset();
      toast.success('Password changed');
    } catch (err) {
      if (err instanceof ApiException && err.fields) password.setServerErrors(err.fields);
      else toast.error('Could not change your password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Profile and password</h1>
      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="pf">
          <h2 id="pf" className="mb-3 text-lg font-semibold">
            Your details
          </h2>
          <form onSubmit={saveProfile} noValidate className="space-y-4">
            <TextField form={profile} name="name" label="Full name" required autoComplete="name" />
            <div>
              <label htmlFor="profile-email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input id="profile-email" className="block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base opacity-50" value={user?.email ?? ''} disabled readOnly aria-describedby="profile-email-hint" />
              <p id="profile-email-hint" className="mt-1 text-sm text-text-muted">
                Email cannot be changed here.
              </p>
            </div>
            <TextField form={profile} name="phone" label="Mobile number" hint="10 digits (optional)" type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={10} />
            <Button type="submit" loading={savingProfile}>
              Save changes
            </Button>
          </form>
        </section>

        <section aria-labelledby="pw">
          <h2 id="pw" className="mb-3 text-lg font-semibold">
            Change password
          </h2>
          <form onSubmit={savePassword} noValidate className="space-y-4">
            <TextField form={password} name="currentPassword" label="Current password" required type="password" autoComplete="current-password" />
            <TextField form={password} name="newPassword" label="New password" required hint={PASSWORD_HINT} type="password" autoComplete="new-password" />
            <Button type="submit" loading={savingPassword}>
              Change password
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
