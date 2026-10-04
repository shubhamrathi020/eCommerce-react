import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The installable, offline-friendly shop (BRD 18, LX-05). The service worker is plain JavaScript whose decisions are pure, so the
 * rules that matter most are tested here against an in-memory cache: above all that nothing price-critical is ever served from it.
 */
const publicDir = resolve(import.meta.dirname, '../public');
// This package is an ES module, so require() would treat sw.js as one; the worker is plain CommonJS-style script, so run it as such.
const swModule = { exports: {} as Record<string, unknown> };
new Function('module', 'exports', readFileSync(resolve(publicDir, 'sw.js'), 'utf8'))(swModule, swModule.exports);
const sw = swModule.exports as unknown as {
  decide: (url: string, method: string, mode: string, origin: string) => string;
  handle: (request: Request, deps: unknown) => Promise<Response>;
  cacheable: (r: Response) => boolean;
  MAX_PAGES: number;
  MAX_PAGE_AGE_MS: number;
  PRECACHE: string[];
};

const ORIGIN = 'https://shop.test';
const req = (path: string, init: { method?: string; mode?: RequestMode } = {}) => {
  const r = new Request(`${ORIGIN}${path}`, { method: init.method ?? 'GET' });
  // Request.mode cannot be set to "navigate" by script, so the tests supply it the way the browser does.
  return Object.defineProperty(r, 'mode', { value: init.mode ?? 'cors' }) as Request;
};

describe('service worker policy: what may be kept', () => {
  const d = (path: string, mode = 'navigate', method = 'GET') => sw.decide(`${ORIGIN}${path}`, method, mode, ORIGIN);

  it('never touches price-critical or private pages: they always come from the network', () => {
    for (const path of ['/cart', '/checkout', '/checkout/payment', '/orders', '/orders/ORD-1/invoice', '/account', '/account/returns', '/notifications', '/wishlist', '/payment/callback', '/personalisation']) {
      expect(d(path), path).toBe('network-only');
    }
  });

  it('never handles the API, other origins, or anything that is not a GET', () => {
    expect(d('/api/cart', 'cors')).toBe('bypass');
    expect(d('/api', 'cors')).toBe('bypass');
    expect(sw.decide('https://api.other.test/cart', 'GET', 'cors', ORIGIN)).toBe('bypass');
    expect(sw.decide('https://checkout.razorpay.com/v1/checkout.js', 'GET', 'no-cors', ORIGIN)).toBe('bypass');
    expect(d('/cart', 'cors', 'POST')).toBe('bypass');
    expect(d('/p/shirt', 'navigate', 'PUT')).toBe('bypass');
  });

  it('allows browsing pages to be kept for offline reading, but only network-first', () => {
    for (const path of ['/', '/c/mobiles', '/p/nova-phone', '/b/nova', '/collections/trending', '/search?q=shirt', '/pages/about', '/compare']) {
      expect(d(path), path).toBe('network-first');
    }
  });

  it('treats unknown navigations as network-only, so a new price-bearing route is safe by default', () => {
    expect(d('/some/new/route')).toBe('network-only');
  });

  it('keeps hashed build files for good and loose assets fresh in the background', () => {
    expect(d('/main-ABCD1234.js', 'script')).toBe('cache-first');
    expect(d('/styles-ZXCV9876.css', 'style')).toBe('cache-first');
    expect(d('/mock/img/p-0001-1.svg', 'no-cors')).toBe('stale-while-revalidate');
    expect(d('/icons/icon-192.png', 'no-cors')).toBe('stale-while-revalidate');
    expect(d('/some-data.json', 'cors')).toBe('bypass');
  });

  it('keeps only plain successes that allow storing', () => {
    expect(sw.cacheable(new Response('ok'))).toBe(true);
    expect(sw.cacheable(new Response('no', { status: 404 }))).toBe(false);
    expect(sw.cacheable(new Response('x', { headers: { 'cache-control': 'no-store' } }))).toBe(false);
    expect(sw.cacheable(new Response('x', { headers: { 'cache-control': 'private, max-age=0' } }))).toBe(false);
  });
});

/** A tiny in-memory CacheStorage. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === 'string' ? new URL(r, ORIGIN).toString() : r.url);
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      match: async (r: Request | string) => store.get(key(r))?.clone(),
      put: async (r: Request | string, res: Response) => void store.set(key(r), res),
      keys: async () => [...store.keys()].map((k) => new Request(k)),
      delete: async (r: Request) => store.delete(key(r)),
    };
  };
  return {
    stores,
    open,
    match: async (r: Request | string) => {
      for (const s of stores.values()) if (s.has(key(r))) return s.get(key(r))?.clone();
      return undefined;
    },
  };
}

function setup(online = true, now = () => Date.parse('2026-10-03T10:00:00Z')) {
  const caches = memoryCaches();
  const calls: string[] = [];
  const state = { online, now };
  const deps = {
    caches,
    origin: ORIGIN,
    now: () => state.now(),
    timeout: 50,
    fetch: async (r: Request) => {
      calls.push(r.url);
      if (!state.online) throw new TypeError('offline');
      return new Response(`<html><head></head>page ${new URL(r.url).pathname}</html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    },
  };
  return { caches, deps, calls, state };
}

describe('service worker behaviour', () => {
  it('opens offline: a visited catalog page comes from the saved copy, marked so the page can warn it is not live', async () => {
    const t = setup();
    const page = req('/p/nova-phone', { mode: 'navigate' });
    const live = await (await sw.handle(page, t.deps)).text();
    expect(live).toContain('page /p/nova-phone');
    expect(live).not.toContain('sw-saved-copy');

    t.state.online = false;
    const offline = await sw.handle(page, t.deps);
    const text = await offline.text();
    expect(text).toContain('page /p/nova-phone');
    expect(text).toMatch(/<head><meta name="sw-saved-copy" content="2026-10-03T10:00:00.000Z">/);
  });

  it('shows the friendly offline page for a page never visited, or one saved too long ago', async () => {
    const t = setup();
    await (await t.caches.open('shop-static-v1')).put(sw.PRECACHE[0], new Response('<h1>You are offline</h1>'));
    t.state.online = false;
    expect(await (await sw.handle(req('/c/never-seen', { mode: 'navigate' }), t.deps)).text()).toContain('You are offline');

    // Saved, then a week and a day pass with no connection.
    t.state.online = true;
    await sw.handle(req('/c/mobiles', { mode: 'navigate' }), t.deps);
    t.state.online = false;
    t.state.now = () => Date.parse('2026-10-03T10:00:00Z') + sw.MAX_PAGE_AGE_MS + 86_400_000;
    expect(await (await sw.handle(req('/c/mobiles', { mode: 'navigate' }), t.deps)).text()).toContain('You are offline');
  });

  it('never saves or serves the cart, checkout or orders, online or off', async () => {
    const t = setup();
    for (const path of ['/cart', '/checkout', '/orders/ORD-1']) {
      expect(await (await sw.handle(req(path, { mode: 'navigate' }), t.deps)).text()).toContain(`page ${path}`);
    }
    expect([...t.caches.stores.values()].every((s) => s.size === 0)).toBe(true);

    // Offline, there is no saved copy to fall back on, only the offline page, so an old price can never appear.
    await (await t.caches.open('shop-static-v1')).put(sw.PRECACHE[0], new Response('<h1>You are offline</h1>'));
    t.state.online = false;
    for (const path of ['/cart', '/checkout']) {
      const text = await (await sw.handle(req(path, { mode: 'navigate' }), t.deps)).text();
      expect(text).toContain('You are offline');
      expect(text).not.toContain('page /');
    }
  });

  it('does not save error pages or pages that forbid storing', async () => {
    const t = setup();
    t.deps.fetch = async () => new Response('private page', { status: 200, headers: { 'cache-control': 'no-store' } });
    await sw.handle(req('/p/x', { mode: 'navigate' }), t.deps);
    t.deps.fetch = async () => new Response('missing', { status: 404 });
    await sw.handle(req('/p/y', { mode: 'navigate' }), t.deps);
    expect((await (await t.caches.open('shop-pages-v1')).keys()).length).toBe(0);
  });

  it('serves a slow network from the saved copy rather than making the visitor wait', async () => {
    const t = setup();
    await sw.handle(req('/', { mode: 'navigate' }), t.deps); // saved while fast
    t.deps.fetch = () => new Promise<Response>(() => undefined); // now it hangs
    const started = Date.now();
    const text = await (await sw.handle(req('/', { mode: 'navigate' }), t.deps)).text();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(text).toContain('page /');
    expect(text).toContain('sw-saved-copy');
  });

  it('caps how many pages it keeps', async () => {
    const t = setup();
    for (let i = 0; i < sw.MAX_PAGES + 10; i++) await sw.handle(req(`/p/item-${i}`, { mode: 'navigate' }), t.deps);
    expect((await (await t.caches.open('shop-pages-v1')).keys()).length).toBe(sw.MAX_PAGES);
  });

  it('keeps hashed files cache-first and never re-downloads them', async () => {
    const t = setup();
    const asset = req('/main-ABCD1234.js', { mode: 'no-cors' });
    await sw.handle(asset, t.deps);
    await sw.handle(asset, t.deps);
    expect(t.calls.filter((u) => u.endsWith('main-ABCD1234.js'))).toHaveLength(1);
  });

  it('leaves API calls entirely alone', async () => {
    const t = setup();
    await sw.handle(req('/api/cart'), t.deps);
    expect([...t.caches.stores.values()].every((s) => s.size === 0)).toBe(true);
  });
});

describe('installable app files', () => {
  const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  /** Width and height from a PNG header. */
  function pngSize(path: string): [number, number] {
    const b = readFileSync(path);
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }

  it('has what a browser needs to offer installation', () => {
    expect(manifest).toMatchObject({ name: 'Shop', short_name: 'Shop', display: 'standalone', scope: '/' });
    expect(manifest.start_url.startsWith('/')).toBe(true);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('lists real icons of the sizes it claims, including 192, 512 and a maskable one', () => {
    for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(resolve(publicDir, icon.src.slice(1)))).toEqual([w, h]);
    }
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    expect(png.some((i) => i.sizes === '192x192')).toBe(true);
    expect(png.some((i) => i.sizes === '512x512' && (i.purpose ?? 'any') === 'any')).toBe(true);
    expect(png.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('precaches only files that exist', () => {
    for (const url of sw.PRECACHE) expect(() => readFileSync(resolve(publicDir, url.slice(1)))).not.toThrow();
  });

  it('offers an offline page with a retry and no scripts or external requests', () => {
    const html = readFileSync(resolve(publicDir, 'offline.html'), 'utf8');
    expect(html).toContain('You are offline');
    expect(html).not.toMatch(/<script|src=["']http|href=["']http/);
  });

  it('is linked from every page along with the early theme script', () => {
    const index = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
    expect(index).toContain('rel="manifest"');
    expect(index).toContain('theme-init.js');
    expect(index).toContain('name="theme-color"');
  });

  it('applies a saved dark or light choice before first paint, and nothing for "system"', () => {
    const script = readFileSync(resolve(publicDir, 'theme-init.js'), 'utf8');
    const run = (saved: string | null) => {
      const attrs: Record<string, string> = {};
      new Function('localStorage', 'document', script)({ getItem: () => saved }, { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } });
      return attrs;
    };
    expect(run('dark')).toEqual({ 'data-theme': 'dark' });
    expect(run('light')).toEqual({ 'data-theme': 'light' });
    expect(run('system')).toEqual({});
    expect(run(null)).toEqual({});
    expect(() => new Function('localStorage', 'document', script)({ getItem: () => { throw new Error('blocked'); } }, { documentElement: {} })).not.toThrow();
  });
});
