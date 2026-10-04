import { useState } from 'react';
import { Link } from 'react-router';
import { firstValueFrom } from 'rxjs';
import type { LinkGroup, NavLink } from '@ecom/contracts';
import { APP_CONFIG, ToastService, useResource, useService, useT } from '@shop/core';
import { ContentApi, NewsletterApi } from '@shop/data-access';
import { Button, FormField, LanguagePicker, ThemeToggle, inputClass } from '@shop/ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GROUPS: { key: LinkGroup; title: string }[] = [
  { key: 'about', title: '' },
  { key: 'help', title: 'footer.help' },
  { key: 'legal', title: 'footer.legal' },
];

export function Footer() {
  const t = useT();
  const siteName = useService(APP_CONFIG).siteName;
  const content = useService(ContentApi);
  const newsletter = useService(NewsletterApi);
  const toast = useService(ToastService);
  const nav = useResource<NavLink[]>(() => content.navigation(), [content]);
  const links = nav.value ?? [];

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const year = new Date().getFullYear();

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!EMAIL.test(email)) {
      setError(email ? t('footer.emailInvalid') : t('footer.emailRequired'));
      return;
    }
    setBusy(true);
    try {
      await firstValueFrom(newsletter.subscribe(email));
      setEmail('');
      toast.success(t('footer.thanks'));
    } catch (err) {
      setError((err as { message?: string }).message ?? t('footer.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="mt-12 block print:hidden border-t border-border bg-surface-alt">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-4 md:px-6">
        {GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`f-${group.key}`}>
            <h2 id={`f-${group.key}`} className="mb-3 font-semibold">
              {group.key === 'about' ? siteName : t(group.title)}
            </h2>
            <ul className="space-y-2 text-sm text-text-muted">
              {links
                .filter((l) => l.group === group.key)
                .map((link) => (
                  <li key={link.id}>
                    {link.href.startsWith('/') ? (
                      <Link to={link.href} className="hover:text-primary hover:underline">
                        {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} rel="noopener noreferrer" className="hover:text-primary hover:underline">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <section aria-labelledby="f-news">
          <h2 id="f-news" className="mb-3 font-semibold">
            {t('footer.newsletter')}
          </h2>
          <form onSubmit={subscribe} noValidate className="space-y-2">
            <FormField label={t('footer.email')} error={error}>
              {(field) => <input id={field.id} type="email" autoComplete="email" inputMode="email" className={inputClass} aria-describedby={field.describedBy} aria-invalid={error ? 'true' : undefined} value={email} onChange={(ev) => setEmail(ev.target.value)} />}
            </FormField>
            <Button type="submit" loading={busy}>
              {t('footer.subscribe')}
            </Button>
          </form>
          <div className="mt-4 space-y-2">
            <LanguagePicker />
            <ThemeToggle />
          </div>
        </section>
      </div>
      <div className="border-t border-border py-4 text-center text-sm text-text-muted">{t('footer.copyright', { year, site: siteName })}</div>
    </footer>
  );
}
