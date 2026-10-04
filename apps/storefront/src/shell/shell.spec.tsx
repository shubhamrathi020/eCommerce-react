import { act, fireEvent } from '@testing-library/react';
import { AttributionService, ConsentService, I18nService, RecentSearchesStore, ThemeService, CompareStore, BottomBarService } from '@shop/core';
import { violations } from '@shop/ui/testing';
import { demo, mount, open, openSignedIn } from '../test-harness';
import { CompareBar } from '../catalog/Compare';
import { OfflineBanner } from './Shell';
import { SearchBox } from './SearchBox';

const text = (root: HTMLElement) => root.textContent ?? '';

describe('shell layout', () => {
  it('renders header, main landmark, footer and category navigation', async () => {
    const page = await open('/');
    const root = page.root();
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
    expect(root.querySelector('a[href="#main"]')?.textContent).toContain('Skip to main content');
    expect(root.querySelectorAll('nav[aria-label="Categories"] button').length).toBeGreaterThanOrEqual(8);
    expect(root.querySelector('section[aria-label="Cookie preferences"]')).not.toBeNull();
    expect(root.querySelector('a[aria-label="Notifications"]')).toBeNull(); // signed out: no bell
  });

  it('shows the notification bell once signed in', async () => {
    const page = await openSignedIn('/');
    expect(page.root().querySelector('a[href="/notifications"]')).not.toBeNull();
    expect(demo.email).toBeTruthy();
  });

  it('moves focus to the new page heading after a route change', async () => {
    const page = await open('/wishlist');
    await page.go('/compare');
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Compare products');
  });

  it('has no serious accessibility violations (structure, names, ARIA)', async () => {
    const page = await open('/pages/about');
    expect(await violations(page.root())).toEqual([]);
  });
});

describe('language and theme in the shell', () => {
  it('switches every covered string to Hindi at once, with no English left on those surfaces', async () => {
    const page = await open('/pages/about');
    const root = page.root();
    const i18n = page.injector.get(I18nService);
    expect(root.querySelector('section[aria-label="Cookie preferences"]')).not.toBeNull();
    expect(text(root.querySelector('footer') as HTMLElement)).toContain('Newsletter');

    await act(async () => i18n.set('hi'));
    await page.settle(4);

    expect(document.documentElement.lang).toBe('hi');
    const banner = root.querySelector('section[aria-label="कुकी प्राथमिकताएँ"]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(text(banner)).toContain('सभी स्वीकार करें');
    expect(text(banner)).toContain('गोपनीयता नीति');
    expect(text(banner)).not.toContain('Accept all');

    const footer = root.querySelector('footer') as HTMLElement;
    expect(text(footer)).toContain('न्यूज़लेटर');
    expect(text(footer)).toContain('सदस्यता लें');
    expect(text(footer)).toContain(`© ${new Date().getFullYear()}`);
    expect(text(footer)).not.toContain('Subscribe');

    const header = root.querySelector('header') as HTMLElement;
    expect(header.querySelector('a[href="/cart"]')?.getAttribute('aria-label')).toBe('कार्ट, 0 वस्तु');
    expect(header.querySelector('a[href="/wishlist"]')?.getAttribute('aria-label')).toBe('विशलिस्ट');
    expect(header.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe('उत्पाद, ब्रांड और बहुत कुछ खोजें');
    expect(header.querySelector('nav[aria-label="खाता और कार्ट"]')).not.toBeNull();

    await act(async () => i18n.set('en'));
    expect(text(root)).toContain('Accept all');
    expect(document.documentElement.lang).toBe('en');
  });

  it('offers a language menu in the footer that works, labels Hindi a draft, and explains it', async () => {
    const page = await open('/pages/about');
    const footer = page.root().querySelector('footer') as HTMLElement;
    const select = Array.from(footer.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'hi')) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toContain('English');
    expect(labels).toContain('हिन्दी (draft translation)');
    expect(text(footer)).not.toContain('not reviewed');

    await act(async () => {
      fireEvent.change(select, { target: { value: 'hi' } });
    });
    expect(page.injector.get(I18nService).locale()).toBe('hi');
    expect(text(footer)).toContain('प्रारंभिक');
    expect(footer.querySelector('select option[value="hi"]')?.textContent).toContain('प्रारंभिक अनुवाद');
  });

  it('flips the page direction for the right-to-left test language and back', async () => {
    const page = await open('/pages/about');
    const i18n = page.injector.get(I18nService);
    await act(async () => i18n.set('rtl'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    await act(async () => i18n.set('en'));
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('keeps the shell accessible in Hindi and in the right-to-left test language', async () => {
    const page = await open('/pages/about');
    const i18n = page.injector.get(I18nService);
    for (const code of ['hi', 'rtl'] as const) {
      await act(async () => i18n.set(code));
      await page.settle(3);
      expect(await violations(page.root())).toEqual([]);
    }
    await act(async () => i18n.set('en'));
  }, 60000);

  it('switches between light, dark and the device setting, and remembers it', async () => {
    document.documentElement.removeAttribute('data-theme');
    const page = await open('/pages/about');
    const theme = page.injector.get(ThemeService);
    const select = Array.from(page.root().querySelectorAll('footer select')).find((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === 'dark')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['Match my device', 'Light', 'Dark']);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    const choose = async (value: string) =>
      act(async () => {
        fireEvent.change(select, { target: { value } });
      });
    await choose('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(theme.effective()).toBe('dark');
    await choose('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await choose('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('search box', () => {
  const type = async (page: Awaited<ReturnType<typeof mount>>, input: HTMLInputElement, value: string) => {
    await act(async () => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
    });
    await page.settle(12);
  };

  it('is an accessible combobox that lists suggestions after a short pause', async () => {
    const page = await mount(<SearchBox idPrefix="t" />);
    const input = page.root().querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await type(page, input, 'lap');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(page.root().querySelectorAll('[role="option"]').length).toBeGreaterThan(2);
    expect(text(page.root())).toContain('Products');
    expect(await violations(page.root())).toEqual([]);
  });

  it('moves with arrow keys, selects with Enter, and closes with Escape', async () => {
    const page = await mount(<SearchBox idPrefix="t" />);
    const input = page.root().querySelector('input') as HTMLInputElement;
    await type(page, input, 'lap');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    });
    expect(input.getAttribute('aria-activedescendant')).toBe('t-opt-0');
    expect(page.root().querySelector('[role="option"][aria-selected="true"]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('submitting searches, saves the term as recent and navigates', async () => {
    const page = await mount(<SearchBox idPrefix="t" />);
    const input = page.root().querySelector('input') as HTMLInputElement;
    await type(page, input, 'sneakers');
    await act(async () => {
      fireEvent.submit(page.root().querySelector('form') as HTMLFormElement);
    });
    expect(page.location()).toContain('/search?q=sneakers');
    expect(page.injector.get(RecentSearchesStore).ids()).toEqual(['sneakers']);
  });

  it('shows recent searches when the empty box is focused', async () => {
    const page = await mount(<SearchBox idPrefix="t" />);
    page.injector.get(RecentSearchesStore).add('yoga mat');
    const input = page.root().querySelector('input') as HTMLInputElement;
    await type(page, input, '');
    expect(text(page.root())).toContain('Recent searches');
    expect(text(page.root())).toContain('yoga mat');
  });

  it('picking a product suggestion navigates to it', async () => {
    const page = await mount(<SearchBox idPrefix="t" />);
    const input = page.root().querySelector('input') as HTMLInputElement;
    await type(page, input, 'lap');
    const product = Array.from(page.root().querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.querySelector('img'));
    expect(product).toBeDefined();
    await act(async () => {
      fireEvent.mouseDown(product as HTMLElement);
    });
    expect(page.location()).toMatch(/^\/p\//);
  });
});

describe('offline banner', () => {
  it('shows only while offline, and reacts to the browser going online again', async () => {
    const page = await mount(<OfflineBanner />);
    expect(page.root().querySelector('[role="status"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(text(page.root())).toContain("You're offline");
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(page.root().querySelector('[role="status"]')).toBeNull();
  });

  it('warns that prices may be old when the page is a saved copy, even after the connection is back', async () => {
    const meta = document.createElement('meta');
    meta.name = 'sw-saved-copy';
    meta.content = '2026-10-03T10:00:00.000Z';
    document.head.appendChild(meta);
    const page = await mount(<OfflineBanner />);
    expect(text(page.root())).toContain('saved copy');
    expect(text(page.root())).toContain('Prices and stock may be out of date');
    meta.remove();
  });
});

describe('compare bar', () => {
  it('is hidden with nothing to compare, and until the cookie banner has a decision', async () => {
    const page = await mount(<CompareBar />);
    expect(page.root().querySelector('[role="region"]')).toBeNull();
    await act(async () => {
      page.injector.get(CompareStore).add('p1');
    });
    expect(page.root().querySelector('[role="region"]')).toBeNull(); // consent still undecided
    await act(async () => page.injector.get(ConsentService).set('essential'));
    expect(page.root().querySelector('[role="region"]')).not.toBeNull();
  });

  it('gets out of the way on mobile while a page reports its own sticky action bar, but not by default', async () => {
    const page = await mount(<CompareBar />);
    await act(async () => {
      page.injector.get(CompareStore).add('p1');
      page.injector.get(ConsentService).set('all');
    });
    const bar = () => page.root().querySelector('[role="region"]') as HTMLElement;
    expect(bar().className).not.toContain('max-md:hidden');
    await act(async () => page.injector.get(BottomBarService).setPrimaryActionVisible(true));
    expect(bar().className).toContain('max-md:hidden');
    await act(async () => page.injector.get(BottomBarService).setPrimaryActionVisible(false));
    expect(bar().className).not.toContain('max-md:hidden');
  });
});

describe('campaign attribution in the shell', () => {
  it('remembers the campaign in the landing URL once analytics are accepted, and not before', async () => {
    const page = await open('/pages/about?utm_source=Google&utm_medium=cpc&utm_campaign=festive-sale');
    const attribution = page.injector.get(AttributionService);
    expect(attribution.touches()).toEqual({}); // no consent yet

    // Accepting analytics on the landing page still credits the campaign that brought the shopper.
    await act(async () => page.injector.get(ConsentService).set('all'));
    await page.settle(3);
    expect(attribution.touches().first).toEqual({ source: 'google', medium: 'cpc', campaign: 'festive-sale' });

    await page.go('/c/mobiles?utm_source=newsletter');
    expect(attribution.touches()).toEqual({ first: { source: 'google', medium: 'cpc', campaign: 'festive-sale' }, last: { source: 'newsletter' } });
  });
});
