import { act, fireEvent } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import { WishlistStore } from '@shop/core';
import { AlertApi, CartApi, CatalogApi, OrderApi } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { button, click, fill, violations } from '@shop/ui/testing';
import { demo, open, openSignedIn } from '../test-harness';

const text = (root: HTMLElement) => root.textContent ?? '';

describe('account pages', () => {
  it('protects account pages: redirects to sign in with a returnUrl, then returns after signing in', async () => {
    const page = await open('/account/addresses');
    await page.settle();
    expect(page.url()).toBe('/account/login?returnUrl=%2Faccount%2Faddresses');
    let main = page.main();
    expect(await violations(page.root())).toEqual([]);

    await click(button(main, 'Sign in'));
    await page.settle();
    expect(main.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);

    await fill(main, 'Email', demo.email);
    await fill(main, 'Password', 'Wrong1234');
    await click(button(main, 'Sign in'));
    await page.settle();
    expect(text(main)).toContain('Incorrect email or password.');

    await fill(main, 'Password', demo.password);
    await click(button(main, 'Sign in'));
    await page.settle(20);
    expect(page.url()).toBe('/account/addresses');
    main = page.main();
    expect(text(main)).toContain('Addresses');
  }, 30000);

  it('ignores an external returnUrl (no open redirect)', async () => {
    const page = await open('/account/login?returnUrl=https%3A%2F%2Fevil.test');
    const main = page.main();
    await fill(main, 'Email', demo.email);
    await fill(main, 'Password', demo.password);
    await click(button(main, 'Sign in'));
    await page.settle(20);
    expect(page.url()).toBe('/account');
  });

  it('registers, shows validation, then lands signed in with an unverified-email reminder', async () => {
    const page = await open('/account/register');
    const main = page.main();
    await click(button(main, 'Create account'));
    await page.settle();
    expect(main.querySelectorAll('[role="alert"]').length).toBeGreaterThan(1);
    await fill(main, 'Full name', 'Asha Rao');
    await fill(main, 'Email', 'asha@example.com');
    await fill(main, 'Password', 'weakpass1');
    await click(button(main, 'Create account'));
    await page.settle(15);
    expect(text(main)).toContain('Use upper case, lower case and a number');
    await fill(main, 'Password', 'Str0ngPass');
    await click(button(main, 'Create account'));
    await page.settle(20);
    expect(page.url()).toBe('/account');
    expect(page.injector.get(AuthStore).loggedIn()).toBe(true);
    expect(text(page.main())).toContain('Please verify your email');
  });

  it('forgot password always shows the same confirmation', async () => {
    const page = await open('/account/forgot-password');
    const main = page.main();
    await fill(main, 'Email', 'nobody@example.com');
    await click(button(main, 'Send reset link'));
    await page.settle();
    expect(text(main)).toContain('If an account exists');
    expect(await violations(page.root())).toEqual([]);
  });

  it('address book: add, make default, delete; profile update; privacy page', async () => {
    const page = await openSignedIn('/account/addresses');
    await page.settle(15);
    let main = page.main();
    expect(text(main)).toContain('No saved addresses');
    await click(button(main, 'Add address'));
    await page.settle();
    for (const [label, value] of [
      ['Label', 'Home'],
      ['Full name', 'Asha Rao'],
      ['Mobile number', '9876543210'],
      ['Pin code', '560001'],
      ['Address line 1', '12 MG Road'],
      ['City', 'Bengaluru'],
      ['State', 'Karnataka'],
    ])
      await fill(main, label, value);
    expect(await violations(page.root())).toEqual([]);
    await click(Array.from(main.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Add address' && b.type === 'submit'));
    await page.settle(15);
    expect(text(main)).toContain('Default');
    expect(text(main)).toContain('12 MG Road');
    await click(button(main, 'Delete'));
    await page.settle(15);
    expect(text(main)).toContain('No saved addresses');

    await page.go('/account/profile');
    main = page.main();
    await fill(main, 'Full name', 'Renamed User');
    await click(button(main, 'Save changes'));
    await page.settle(15);
    expect(page.injector.get(AuthStore).user()?.name).toBe('Renamed User');
    expect(await violations(page.root())).toEqual([]);

    await page.go('/account/privacy');
    main = page.main();
    expect(text(main)).toContain('Export my data');
    expect(await violations(page.root())).toEqual([]);
  }, 40000);

  it('wishlist page works for guests and can remove items', async () => {
    const page = await open('/wishlist');
    expect(text(page.main())).toContain('Your wishlist is empty');
    const store = page.injector.get(WishlistStore);
    await act(async () => {
      store.toggle('p-0001');
      store.toggle('p-0002');
    });
    await page.settle(15);
    const main = page.main();
    expect(main.querySelectorAll('article')).toHaveLength(2);
    await click(main.querySelector('article button[aria-pressed]'));
    await page.settle();
    expect(main.querySelectorAll('article')).toHaveLength(1);
  }, 20000);

  it('notification preferences: toggles save, and the one-click unsubscribe link turns marketing back off', async () => {
    const page = await openSignedIn('/account/preferences');
    await page.settle(15);
    let main = page.main();
    expect(text(main)).toContain('Always on');
    expect(await violations(page.root())).toEqual([]);

    await click(main.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]);
    await page.settle(15);
    expect(text(main)).toContain('Saved');
    expect(text(main)).toContain('one-click unsubscribe link');

    await click(button(main, 'Show my unsubscribe link'));
    await page.settle(15);
    const href = main.querySelector<HTMLAnchorElement>('a[href*="/unsubscribe"]')?.getAttribute('href') as string;
    expect(href).toContain('token=');

    await page.go(new URL(href, 'http://x').pathname + new URL(href, 'http://x').search);
    main = page.main();
    expect(text(main)).toContain("You're unsubscribed");
    expect(text(main)).toContain('marketing emails');
    expect(await violations(page.root())).toEqual([]);

    await page.go('/account/preferences');
    main = page.main();
    expect(main.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].checked).toBe(false);
  }, 40000);

  it('unsubscribe page shows a clear error for a missing or invalid token', async () => {
    const page = await open('/unsubscribe');
    expect(text(page.main())).toContain("didn't work");
    await page.go('/unsubscribe?token=bogus');
    expect(text(page.main())).toContain("didn't work");
  });

  it('the notification bell lists an order update and mark-all-read clears the unread count', async () => {
    const page = await openSignedIn('/notifications', async (injector) => {
      const catalog = injector.get(CatalogApi);
      const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 30 }));
      const found = (await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 1);
      await firstValueFrom(injector.get(CartApi).add(found?.id as string, 1));
      await firstValueFrom(
        injector.get(OrderApi).place({ idempotencyKey: 'nb1', contact: { name: 'Asha Rao', email: demo.email, phone: '9876543210' }, address: { line1: '1 Road', city: 'Bengaluru', state: 'KA', pincode: '560001' }, paymentMethod: 'cod' }),
      );
    });
    await page.settle(15);
    const main = page.main();
    expect(text(main)).toContain('confirmed');
    expect(await violations(page.root())).toEqual([]);
    await click(button(main, 'Mark all as read'));
    await page.settle(15);
    expect(main.querySelector('button')?.textContent).not.toContain('Mark all as read');
  }, 30000);

  it('your alerts lists a subscribed item and removing it empties the page', async () => {
    const page = await openSignedIn('/account/alerts', async (injector) => {
      const catalog = injector.get(CatalogApi);
      const listing = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 10 }));
      const found = (await firstValueFrom(catalog.productsByIds(listing.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 1);
      await firstValueFrom(injector.get(AlertApi).subscribe('price_drop', found?.id as string));
    });
    await page.settle(15);
    let main = page.main();
    expect(text(main)).toContain('Alert on price drop');
    expect(await violations(page.root())).toEqual([]);
    await click(button(main, 'Remove'));
    await page.settle(15);
    main = page.main();
    expect(text(main)).toContain('No alerts yet');
    expect(fireEvent).toBeDefined();
  }, 30000);
});
