import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiException, type NotificationPreferences, type SavedAddress } from '@ecom/contracts';
import { I18nService, PushOptInService, SeoService, ToastService, useDate, useResource, useService, useSignal, useT } from '@shop/core';
import { AddressBookApi, AuthApi, PreferenceApi, type AddressInput } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Button, EmptyState, FormField, Skeleton, TextField, inputClass, rules, useForm } from '@shop/ui';

const fieldRules = {
  label: rules.required(),
  name: rules.required(),
  phone: rules.all(rules.required(), rules.pattern(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')),
  line1: rules.required(),
  city: rules.required(),
  state: rules.required(),
  pincode: rules.all(rules.required(), rules.pattern(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pin code')),
};
const EMPTY_ADDRESS = { label: '', name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

export function AddressesPage() {
  const api = useService(AddressBookApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const list = useResource(() => api.list(), [api]);
  const [override, setOverride] = useState<SavedAddress[] | null>(null);
  const addresses = override ?? list.value ?? [];
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm(EMPTY_ADDRESS, fieldRules);

  useEffect(() => {
    seo.set({ title: 'Addresses', noindex: true, path: '/account/addresses' });
  }, [seo]);

  const startAdd = () => {
    form.reset(EMPTY_ADDRESS);
    setEditingId(null);
    setEditing(true);
  };
  const startEdit = (a: SavedAddress) => {
    form.reset({ label: a.label, name: a.name, phone: a.phone, line1: a.address.line1, line2: a.address.line2 ?? '', city: a.address.city, state: a.address.state, pincode: a.address.pincode });
    setEditingId(a.id);
    setEditing(true);
  };

  const apply = async (request: Observable<SavedAddress[]>, success: string): Promise<boolean> => {
    try {
      setOverride(await firstValueFrom(request));
      toast.success(success);
      return true;
    } catch (e) {
      if (e instanceof ApiException && e.fields) form.setServerErrors(e.fields);
      else toast.error(e instanceof ApiException ? e.message : 'Something went wrong.');
      return false;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.validate()) return;
    const f = form.values;
    const input: AddressInput = { label: f.label, name: f.name, phone: f.phone, address: { line1: f.line1, ...(f.line2.trim() ? { line2: f.line2 } : {}), city: f.city, state: f.state, pincode: f.pincode } };
    setBusy(true);
    const ok = await apply(editingId ? api.update(editingId, input) : api.add(input), editingId ? 'Address updated' : 'Address added');
    setBusy(false);
    if (ok) setEditing(false);
  };

  const link = 'min-h-11 px-2 text-sm font-medium hover:underline';
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold md:text-3xl">Addresses</h1>
        {!editing && (
          <Button type="button" onClick={startAdd}>
            Add address
          </Button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} noValidate className="mb-6 grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2" aria-label="Address form">
          <TextField form={form} name="label" label="Label (for example Home)" required maxLength={30} />
          <TextField form={form} name="name" label="Full name" required autoComplete="name" />
          <TextField form={form} name="phone" label="Mobile number" required type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={10} />
          <TextField form={form} name="pincode" label="Pin code" required autoComplete="postal-code" inputMode="numeric" maxLength={6} />
          <TextField form={form} name="line1" label="Address line 1" required className="md:col-span-2" autoComplete="address-line1" />
          <TextField form={form} name="line2" label="Address line 2 (optional)" className="md:col-span-2" autoComplete="address-line2" />
          <TextField form={form} name="city" label="City" required autoComplete="address-level2" />
          <TextField form={form} name="state" label="State" required autoComplete="address-level1" />
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" loading={busy}>
              {editingId ? 'Save address' : 'Add address'}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {list.loading && !addresses.length ? (
        <Skeleton className="h-24" />
      ) : addresses.length === 0 && !editing ? (
        <EmptyState title="No saved addresses" description="Add one to speed up checkout." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-border p-4">
              <p className="flex items-center gap-2 font-semibold">
                {a.label} {a.isDefault && <Badge tone="primary">Default</Badge>}
              </p>
              <p className="text-sm">
                {a.name}, {a.phone}
              </p>
              <p className="text-sm text-text-muted">
                {a.address.line1}
                {a.address.line2 ? ', ' + a.address.line2 : ''}, {a.address.city}, {a.address.state} {a.address.pincode}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={`${link} text-primary`} onClick={() => startEdit(a)}>
                  Edit<span className="sr-only"> {a.label}</span>
                </button>
                {!a.isDefault && (
                  <button type="button" className={`${link} text-primary`} onClick={() => void apply(api.setDefault(a.id), `${a.label} is now your default address`)}>
                    Make default<span className="sr-only"> {a.label}</span>
                  </button>
                )}
                <button type="button" className={`${link} text-danger`} onClick={() => void apply(api.remove(a.id), 'Address deleted')}>
                  Delete<span className="sr-only"> {a.label}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Order, security and payment messages are always on and are not shown as a toggle here. */
export function PreferencesPage() {
  const api = useService(PreferenceApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const i18n = useService(I18nService);
  const push = useService(PushOptInService);
  const t = useT();
  const date = useDate();
  const pushState = useSignal(push.state);
  const resource = useResource(() => api.get(), [api]);
  const [local, setLocal] = useState<NotificationPreferences | null>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [unsubLink, setUnsubLink] = useState('');
  const prefs = local ?? resource.value;

  useEffect(() => {
    seo.set({ title: 'Notification preferences', noindex: true, path: '/account/preferences' });
  }, [seo]);
  useEffect(() => {
    if (resource.value) setLocal(resource.value);
  }, [resource.value]);

  const toggle = async (key: keyof NotificationPreferences, checked: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: checked } as NotificationPreferences;
    setLocal(next);
    try {
      setLocal(await firstValueFrom(api.save(next)));
      setSavedMessage('Saved');
      setTimeout(() => setSavedMessage(''), 2000);
    } catch (e) {
      setLocal(prefs);
      toast.error(e instanceof ApiException ? e.message : 'Could not save your preferences.');
    }
  };

  const loadLink = async () => {
    try {
      setUnsubLink(await firstValueFrom(api.unsubscribeLink('marketing')));
    } catch {
      toast.error('Could not load your unsubscribe link.');
    }
  };

  const pushMessage = { on: t('push.on'), off: t('push.off'), blocked: t('push.denied'), unsupported: t('push.unsupported') }[pushState];
  const row = 'flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4';
  const check = 'mt-1 size-5 shrink-0 accent-primary';

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Notification preferences</h1>
      <p className="mb-6 max-w-xl text-sm text-text-muted">Order, payment and account messages always reach you. Everything else is your choice.</p>

      {prefs ? (
        <div className="max-w-xl space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4 opacity-70">
            <div>
              <p className="font-medium">Order updates</p>
              <p className="text-sm text-text-muted">Placed, paid, packed, shipped, delivered and cancelled.</p>
            </div>
            <span className="mt-1 shrink-0 rounded-full bg-surface-alt px-2 py-1 text-xs font-medium">Always on</span>
          </div>

          <label className={row}>
            <span>
              <span className="block font-medium">Marketing emails</span>
              <span className="block text-sm text-text-muted">
                Sales, new arrivals and offers.
                {prefs.marketingConsentAt && <span className="block text-xs">Consent given {date(prefs.marketingConsentAt, 'd MMM y')}</span>}
              </span>
            </span>
            <input type="checkbox" className={check} checked={prefs.marketing} onChange={(e) => void toggle('marketing', e.target.checked)} />
          </label>

          <label className={row}>
            <span>
              <span className="block font-medium">Back-in-stock alerts</span>
              <span className="block text-sm text-text-muted">Lets you use "Notify me" on out-of-stock products.</span>
            </span>
            <input type="checkbox" className={check} checked={prefs.backInStockAlerts} onChange={(e) => void toggle('backInStockAlerts', e.target.checked)} />
          </label>

          <label className={row}>
            <span>
              <span className="block font-medium">Price-drop alerts</span>
              <span className="block text-sm text-text-muted">Lets you use "Alert me on price drop" on product pages.</span>
            </span>
            <input type="checkbox" className={check} checked={prefs.priceDropAlerts} onChange={(e) => void toggle('priceDropAlerts', e.target.checked)} />
          </label>

          {prefs.marketing && (
            <div className="text-sm text-text-muted">
              <p>Every marketing email ends with this one-click unsubscribe link.</p>
              {unsubLink ? (
                <a href={unsubLink} className="break-all text-primary underline">
                  {unsubLink}
                </a>
              ) : (
                <button type="button" className="text-primary underline" onClick={() => void loadLink()}>
                  Show my unsubscribe link
                </button>
              )}
            </div>
          )}
          <p aria-live="polite" className="text-sm text-success">
            {savedMessage}
          </p>

          <section className="rounded-lg border border-border p-4" aria-labelledby="push-h">
            <h2 id="push-h" className="font-medium">
              {t('push.title')}
            </h2>
            <p className="text-sm text-text-muted">{t('push.text')}</p>
            <p className="mt-1 text-xs text-text-muted">{t('push.demo')}</p>
            <p className="mt-2 text-sm" role="status">
              {pushMessage}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pushState === 'on' ? (
                <>
                  <Button variant="secondary" size="sm" type="button" onClick={() => void push.disable()}>
                    {t('push.disable')}
                  </Button>
                  <Button variant="secondary" size="sm" type="button" onClick={() => void push.sendTest(i18n.t('push.testTitle'), i18n.t('push.testBody'))}>
                    {t('push.test')}
                  </Button>
                </>
              ) : (
                pushState !== 'unsupported' &&
                pushState !== 'blocked' && (
                  <Button size="sm" type="button" onClick={() => void push.enable()}>
                    {t('push.enable')}
                  </Button>
                )
              )}
            </div>
          </section>
        </div>
      ) : (
        <Skeleton className="h-64 max-w-xl" />
      )}
    </>
  );
}

export function PrivacyPage() {
  const api = useService(AuthApi);
  const auth = useService(AuthStore);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    seo.set({ title: 'Privacy', noindex: true, path: '/account/privacy' });
  }, [seo]);

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await firstValueFrom(api.exportData());
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'my-data.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not export your data.');
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password) {
      setError('Enter your password to confirm');
      return;
    }
    setDeleting(true);
    try {
      await firstValueFrom(api.deleteAccount(password));
      await auth.logout();
      toast.success('Your account was deleted.');
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Could not delete the account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Privacy</h1>
      <section className="mb-8 max-w-xl" aria-labelledby="ex">
        <h2 id="ex" className="mb-1 text-lg font-semibold">
          Export my data
        </h2>
        <p className="mb-3 text-sm text-text-muted">Download your profile, saved addresses and order numbers as a JSON file.</p>
        <Button variant="secondary" type="button" loading={exporting} onClick={() => void exportData()}>
          Download my data
        </Button>
      </section>

      <section className="max-w-xl rounded-lg border border-danger p-4" aria-labelledby="del">
        <h2 id="del" className="mb-1 text-lg font-semibold">
          Delete my account
        </h2>
        <p className="mb-3 text-sm text-text-muted">This removes your account, saved addresses and sign-in. Past orders are kept for accounting but no longer linked to you. This cannot be undone.</p>
        {!confirming ? (
          <Button variant="danger" type="button" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        ) : (
          <form onSubmit={deleteAccount} noValidate className="space-y-3">
            <FormField label="Confirm with your password" error={error}>
              {(f) => <input id={f.id} type="password" className={inputClass} autoComplete="current-password" aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />}
            </FormField>
            <div className="flex gap-2">
              <Button variant="danger" type="submit" loading={deleting}>
                Permanently delete
              </Button>
              <Button variant="ghost" type="button" onClick={() => setConfirming(false)}>
                Keep my account
              </Button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
