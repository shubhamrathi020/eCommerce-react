import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { firstValueFrom } from 'rxjs';
import { ApiException, type AlertSubscription, type AppNotification } from '@ecom/contracts';
import { CART_FACADE, ConsentService, PersonalisationService, SeoService, ToastService, WishlistStore, useDate, useResource, useService, useSignal } from '@shop/core';
import { AlertApi, CatalogApi, MockMailbox, PreferenceApi, RecommendationApi, type MockMail } from '@shop/data-access';
import { NotificationStore } from '@shop/state';
import { Button, ButtonLink, EmptyState, ProductCard, Skeleton, cx } from '@shop/ui';

const ALERT_LABEL: Record<AlertSubscription['kind'], string> = { back_in_stock: 'Notify when back in stock', price_drop: 'Alert on price drop' };

/** The shopper's "notify me" and "alert me" subscriptions, with a way to remove each one. */
export function AlertsPage() {
  const api = useService(AlertApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const resource = useResource(() => api.list(), [api]);
  useEffect(() => {
    seo.set({ title: 'Your alerts', noindex: true, path: '/account/alerts' });
  }, [seo]);

  const remove = async (a: AlertSubscription) => {
    await firstValueFrom(api.remove(a.id));
    resource.reload();
    toast.info(`Removed the alert for "${a.title}"`);
  };

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Your alerts</h1>
      <p className="mb-4 text-sm text-text-muted">
        Products you asked to be told about. Manage which alerts you can subscribe to on the{' '}
        <Link to="/account/preferences" className="text-primary underline">
          preferences
        </Link>{' '}
        page.
      </p>
      {!resource.value ? (
        <Skeleton className="h-48" />
      ) : resource.value.length === 0 ? (
        <EmptyState title="No alerts yet" description="Look for “Notify me” or “Alert me on price drop” on a product page.">
          <ButtonLink to="/">Browse products</ButtonLink>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {resource.value.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <Link to={`/p/${a.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
                <img src={a.image.url} width={56} height={56} alt="" className="size-14 rounded-md object-cover" />
              </Link>
              <span className="min-w-0 flex-1">
                <Link to={`/p/${a.slug}`} className="block truncate font-medium hover:text-primary">
                  {a.title}
                </Link>
                <span className="block text-sm text-text-muted">{ALERT_LABEL[a.kind]}</span>
              </span>
              <button type="button" className="min-h-11 shrink-0 px-2 text-sm font-medium text-danger hover:underline" onClick={() => void remove(a)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The notification centre: order, review and alert events, newest first. */
export function NotificationsPage() {
  const store = useService(NotificationStore);
  const seo = useService(SeoService);
  const navigate = useNavigate();
  const date = useDate();
  const loaded = useSignal(store.loaded);
  const unread = useSignal(store.unreadCount);
  const items = useSignal(store.notifications);

  useEffect(() => {
    seo.set({ title: 'Notifications', noindex: true, path: '/notifications' });
    // Refresh on every visit: the store's cache does not otherwise know about orders or alerts placed elsewhere.
    void store.refresh(true);
  }, [seo, store]);

  const open = async (n: AppNotification) => {
    if (!n.read) await store.markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">Notifications</h1>
        {unread > 0 && (
          <Button variant="secondary" size="sm" type="button" onClick={() => void store.markAllRead()}>
            Mark all as read
          </Button>
        )}
      </div>
      {!loaded ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState title="No notifications yet" description="Order updates and the alerts you subscribe to will show up here." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" aria-live="polite">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className={cx('flex min-h-11 w-full items-start gap-3 p-4 text-start hover:bg-surface-alt', !n.read && 'bg-surface-alt')} onClick={() => void open(n)}>
                <span className={cx('mt-2 size-2 shrink-0 rounded-full', !n.read && 'bg-primary')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {n.title}
                    {!n.read && <span className="sr-only"> (unread)</span>}
                  </span>
                  <span className="block text-sm text-text-muted">{n.body}</span>
                  <span className="block text-xs text-text-muted">{date(n.createdAt, 'd MMM y, h:mm a')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Saved products (kept on this device until wishlists move to the server). */
export function WishlistPage() {
  const store = useService(WishlistStore);
  const api = useService(CatalogApi);
  const cart = useService(CART_FACADE);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const ids = useSignal(store.ids);
  const resource = useResource(() => api.summariesByIds(ids), [api, ids.join(',')], ids.length > 0);
  useEffect(() => {
    seo.set({ title: 'Wishlist', noindex: true, path: '/wishlist' });
  }, [seo]);

  // Drops products removed just now; the rest keep the order the API returned.
  const saved = new Set(ids);
  const items = (resource.value ?? []).filter((p) => saved.has(p.id));

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">Your wishlist</h1>
      {ids.length === 0 ? (
        <EmptyState title="Your wishlist is empty" description="Tap the heart on any product to save it here.">
          <ButtonLink to="/">Continue shopping</ButtonLink>
        </EmptyState>
      ) : !resource.value ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
          {items.map((product) => (
            <li key={product.id}>
              <ProductCard
                product={product}
                wishlisted
                onWishlistToggle={() => {
                  store.toggle(product.id);
                  toast.info('Removed from your wishlist');
                }}
                onCompareToggle={() => undefined}
                onQuickAdd={() => {
                  if (product.quickAddVariantId) void cart.add({ productId: product.id, variantId: product.quickAddVariantId, quantity: 1, title: product.title });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Reached from an email link; works without signing in. Turns off one preference channel. */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const api = useService(PreferenceApi);
  const seo = useService(SeoService);
  const [status, setStatus] = useState<'working' | 'done' | 'error'>(token ? 'working' : 'error');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(token ? '' : 'This link is missing its token.');

  useEffect(() => {
    seo.set({ title: 'Unsubscribe', noindex: true, path: '/unsubscribe' });
  }, [seo]);

  useEffect(() => {
    if (!token) return;
    let current = true;
    firstValueFrom(api.unsubscribe(token)).then(
      (r) => {
        if (!current) return;
        setLabel(r.label);
        setStatus('done');
      },
      (e: unknown) => {
        if (!current) return;
        setError(e instanceof ApiException ? e.message : 'This link is invalid or has expired.');
        setStatus('error');
      },
    );
    return () => {
      current = false;
    };
  }, [api, token]);

  return (
    <div className="mx-auto max-w-md text-center">
      {status === 'done' ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">You're unsubscribed</h1>
          <p className="text-text-muted">You will no longer receive {label}. You can turn this back on any time.</p>
        </>
      ) : status === 'error' ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">That link didn't work</h1>
          <p className="text-text-muted">{error}</p>
        </>
      ) : (
        <p className="text-text-muted">Working on it…</p>
      )}
      <ButtonLink to="/account/preferences" className="mt-6 inline-flex">
        Manage all preferences
      </ButtonLink>
    </div>
  );
}

/** Public page: what we record to personalise the shop, and the controls to stop it or wipe it. */
export function PersonalisationPage() {
  const consent = useService(ConsentService);
  const personalisation = useService(PersonalisationService);
  const api = useService(RecommendationApi);
  const toast = useService(ToastService);
  const seo = useService(SeoService);
  const analyticsAllowed = useSignal(consent.analyticsAllowed);
  const optedOut = useSignal(personalisation.optedOut);
  const count = useResource(() => api.historyCount(), [api]);
  const [message, setMessage] = useState('');
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    seo.set({ title: 'Personalisation and privacy', noindex: true, path: '/personalisation' });
  }, [seo]);

  const events = count.value ?? 0;
  const clear = async () => {
    setClearing(true);
    try {
      await firstValueFrom(api.clearHistory());
      toast.success('Your activity history was cleared.');
      count.reload();
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Personalisation and privacy</h1>
      <p className="mb-6 max-w-2xl text-sm text-text-muted">
        Rows such as “Recommended for you” and “Trending” are built from simple, anonymous activity: which products you viewed, added to your cart or bought. Nothing recorded contains your name, email or account. It stays on this device in the demo shop.
      </p>

      <div className="max-w-xl space-y-4">
        <section className="rounded-lg border border-border p-4" aria-labelledby="consent-h">
          <h2 id="consent-h" className="font-semibold">
            Analytics
          </h2>
          {analyticsAllowed ? (
            <>
              <p className="text-sm text-text-muted">You accepted analytics, so browsing activity is recorded unless you opt out below.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                type="button"
                onClick={() => {
                  consent.set('essential');
                  setMessage('Analytics are off. Nothing further will be recorded.');
                }}
              >
                Stop recording (essential only)
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-text-muted">Nothing is being recorded, because you have not accepted analytics. Recommendations still work, using what is popular with everyone.</p>
              <Button variant="secondary" size="sm" className="mt-2" type="button" onClick={() => consent.set('all')}>
                Allow analytics
              </Button>
            </>
          )}
        </section>

        <section className="rounded-lg border border-border p-4" aria-labelledby="optout-h">
          <h2 id="optout-h" className="font-semibold">
            Personalised recommendations
          </h2>
          <label className="mt-1 flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              checked={optedOut}
              onChange={(e) => {
                personalisation.setOptOut(e.target.checked);
                setMessage(e.target.checked ? 'Opted out. Your activity is no longer recorded and recommendations are not personalised.' : 'Personalisation is on again.');
              }}
            />
            <span>
              <strong>Opt out.</strong> Stop recording my activity and show me popular items instead of items picked for me.
            </span>
          </label>
          <p aria-live="polite" className="mt-1 text-sm text-success">
            {message}
          </p>
        </section>

        <section className="rounded-lg border border-border p-4" aria-labelledby="history-h">
          <h2 id="history-h" className="font-semibold">
            My activity
          </h2>
          <p className="text-sm text-text-muted">{events} event(s) recorded for this browser.</p>
          <Button variant="danger" size="sm" className="mt-2" type="button" disabled={events === 0} loading={clearing} onClick={() => void clear()}>
            Clear my history
          </Button>
          <p className="mt-1 text-xs text-text-muted">This deletes the activity recorded for this browser and gives it a new anonymous identity.</p>
        </section>
      </div>
    </>
  );
}

/** Development-only inbox for the emails the mock backend would send (verification, reset, order confirmations). */
export function MailboxPage() {
  const mailbox = useService(MockMailbox);
  const seo = useService(SeoService);
  const date = useDate();
  const [mails, setMails] = useState<MockMail[]>(() => mailbox.list());
  useEffect(() => {
    seo.set({ title: 'Demo mailbox', noindex: true });
  }, [seo]);
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold md:text-3xl">Demo mailbox</h1>
      <p className="mb-4 text-sm text-text-muted">Development only. No real email is sent; messages the shop would send appear here.</p>
      {mails.length === 0 ? (
        <EmptyState title="No emails yet" description="Register, request a password reset or place an order to see messages." />
      ) : (
        <>
          <Button
            variant="secondary"
            type="button"
            className="mb-4"
            onClick={() => {
              mailbox.clear();
              setMails([]);
            }}
          >
            Clear mailbox
          </Button>
          <ul className="space-y-3">
            {mails.map((m) => (
              <li key={m.id} className="rounded-lg border border-border p-4">
                <p className="text-sm text-text-muted">
                  To {m.to} · {date(m.sentAt, 'd MMM, h:mm a')}
                </p>
                <p className="font-semibold">{m.subject}</p>
                <p className="text-sm">{m.body}</p>
                {m.link && (
                  <a href={m.link} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary underline">
                    Open link
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/" className="mt-6 inline-flex min-h-11 items-center text-sm text-primary hover:underline">
        Back to the shop
      </Link>
    </>
  );
}
