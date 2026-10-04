/*
 * Service worker for the shop (BRD 18, LX-05). Plain JavaScript, no build step, so it can be read and tested as written.
 *
 * What it does:
 *  - lets the shop open offline: a friendly offline page, and saved copies of pages the visitor has already browsed;
 *  - keeps hashed scripts, styles, fonts and images so repeat visits are fast.
 *
 * What it never does (the non-functional rule: "never serve stale prices at checkout"):
 *  - it never stores or answers from cache for the cart, checkout, orders, account, payment or any /api/ request;
 *  - it never handles anything that is not a GET to this site;
 *  - a saved catalog page is used only when the network fails and it is at most seven days old, and it is marked with a
 *    <meta name="sw-saved-copy"> tag so the page can warn that prices and stock may be out of date.
 *
 * `decide` and `handle` take their dependencies as arguments so the unit tests can exercise them without a browser.
 */
(function (root) {
  var VERSION = 'v1';
  var STATIC_CACHE = 'shop-static-' + VERSION;
  var PAGE_CACHE = 'shop-pages-' + VERSION;
  var OFFLINE_URL = '/offline.html';
  var PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon.svg'];
  var MAX_PAGES = 40;
  var MAX_PAGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  var NETWORK_TIMEOUT_MS = 4000;

  // Anything private or price-critical goes straight to the network, always.
  var NETWORK_ONLY = ['/cart', '/checkout', '/orders', '/account', '/notifications', '/wishlist', '/payment', '/dev', '/personalisation', '/unsubscribe'];
  var BROWSE = ['/c/', '/p/', '/b/', '/collections/', '/search', '/pages/', '/compare'];
  // Build output is named like main-ABCD1234.js or chunk-DY-Gbuxs2.js: a dash, then 8 to 12 letters, digits, dashes or underscores.
  var HASHED_ASSET = /-[A-Za-z0-9_-]{8,12}\.(js|css|woff2?)$/;
  var LOOSE_ASSET = /^\/(mock\/img\/|icons\/|favicon\.ico|manifest\.webmanifest)/;

  function startsWithAny(path, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      var p = prefixes[i];
      if (path === p || path.indexOf(p.charAt(p.length - 1) === '/' ? p : p + '/') === 0 || path.indexOf(p + '?') === 0) return true;
    }
    return false;
  }

  /**
   * How to answer a request: 'bypass' (leave it to the browser), 'network-only', 'network-first',
   * 'cache-first' or 'stale-while-revalidate'.
   */
  function decide(url, method, mode, ownOrigin) {
    if (method !== 'GET') return 'bypass';
    var u = new URL(url);
    if (u.origin !== ownOrigin) return 'bypass'; // the API and the payment provider live elsewhere and are never touched
    var path = u.pathname;
    if (path.indexOf('/api/') === 0 || path === '/api') return 'bypass';
    if (mode === 'navigate') {
      if (startsWithAny(path, NETWORK_ONLY)) return 'network-only';
      if (path === '/' || startsWithAny(path, BROWSE)) return 'network-first';
      return 'network-only';
    }
    if (HASHED_ASSET.test(path)) return 'cache-first';
    if (LOOSE_ASSET.test(path)) return 'stale-while-revalidate';
    return 'bypass';
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('timeout'));
      }, ms);
      promise.then(
        function (v) {
          clearTimeout(timer);
          resolve(v);
        },
        function (e) {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /** A response may be kept only if it is a plain success that does not forbid storing. */
  function cacheable(response) {
    if (!response || response.status !== 200 || response.type === 'opaque') return false;
    var control = (response.headers.get('cache-control') || '').toLowerCase();
    return control.indexOf('no-store') === -1 && control.indexOf('private') === -1;
  }

  async function offlinePage(deps) {
    var cached = await deps.caches.match(OFFLINE_URL);
    return cached || new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  /** Stores a copy of a page along with when it was saved, then trims the oldest entries. */
  async function savePage(request, response, deps) {
    var cache = await deps.caches.open(PAGE_CACHE);
    var headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(deps.now()));
    var body = await response.blob();
    await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers: headers }));
    var keys = await cache.keys();
    for (var i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
  }

  /** Adds the saved-copy marker to a saved HTML page so the page itself can tell the visitor it is not live. */
  async function markSavedCopy(saved, savedAt) {
    if ((saved.headers.get('content-type') || '').indexOf('text/html') === -1) return saved;
    var html = await saved.text();
    var marker = '<meta name="sw-saved-copy" content="' + new Date(savedAt).toISOString() + '">';
    var headers = new Headers(saved.headers);
    headers.delete('content-length');
    var marked = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (tag) { return tag + marker; }) : marker + html;
    return new Response(marked, { status: saved.status, statusText: saved.statusText, headers: headers });
  }

  async function handle(request, deps) {
    var strategy = decide(request.url, request.method, request.mode, deps.origin);
    if (strategy === 'bypass') return deps.fetch(request);

    if (strategy === 'network-only') {
      try {
        return await deps.fetch(request);
      } catch (e) {
        return request.mode === 'navigate' ? offlinePage(deps) : Response.error();
      }
    }

    if (strategy === 'network-first') {
      try {
        var fresh = await withTimeout(deps.fetch(request), deps.timeout || NETWORK_TIMEOUT_MS);
        if (cacheable(fresh)) await savePage(request, fresh.clone(), deps);
        return fresh;
      } catch (e) {
        var saved = await (await deps.caches.open(PAGE_CACHE)).match(request);
        var savedAt = saved ? Number(saved.headers.get('sw-cached-at') || 0) : 0;
        if (saved && deps.now() - savedAt <= MAX_PAGE_AGE_MS) {
          return markSavedCopy(saved, savedAt);
        }
        return offlinePage(deps);
      }
    }

    var cache = await deps.caches.open(STATIC_CACHE);
    var hit = await cache.match(request);
    if (strategy === 'cache-first') {
      if (hit) return hit;
      var loaded = await deps.fetch(request);
      if (cacheable(loaded)) await cache.put(request, loaded.clone());
      return loaded;
    }
    // stale-while-revalidate
    var refresh = deps.fetch(request).then(function (r) {
      if (cacheable(r)) cache.put(request, r.clone());
      return r;
    });
    if (hit) {
      refresh.catch(function () {});
      return hit;
    }
    return refresh;
  }

  var api = { decide: decide, handle: handle, cacheable: cacheable, STATIC_CACHE: STATIC_CACHE, PAGE_CACHE: PAGE_CACHE, OFFLINE_URL: OFFLINE_URL, PRECACHE: PRECACHE, MAX_PAGES: MAX_PAGES, MAX_PAGE_AGE_MS: MAX_PAGE_AGE_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ---------- browser wiring (skipped when loaded by a test) ----------
  if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && self.registration) {
    self.addEventListener('install', function (event) {
      event.waitUntil(
        caches
          .open(STATIC_CACHE)
          .then(function (cache) {
            return cache.addAll(PRECACHE);
          })
          .then(function () {
            return self.skipWaiting();
          }),
      );
    });

    self.addEventListener('activate', function (event) {
      event.waitUntil(
        caches
          .keys()
          .then(function (names) {
            return Promise.all(
              names
                .filter(function (n) {
                  return (n.indexOf('shop-') === 0) && n !== STATIC_CACHE && n !== PAGE_CACHE;
                })
                .map(function (n) {
                  return caches.delete(n);
                }),
            );
          })
          .then(function () {
            return self.clients.claim();
          }),
      );
    });

    self.addEventListener('fetch', function (event) {
      var strategy = decide(event.request.url, event.request.method, event.request.mode, self.location.origin);
      if (strategy === 'bypass') return; // not ours: the browser handles it as if there were no service worker
      event.respondWith(handle(event.request, { caches: caches, fetch: self.fetch.bind(self), now: Date.now, origin: self.location.origin }));
    });

    // Tapping an order-update notification opens the customer's orders.
    self.addEventListener('notificationclick', function (event) {
      event.notification.close();
      event.waitUntil(self.clients.openWindow('/orders'));
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
