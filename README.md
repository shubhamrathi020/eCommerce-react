# eCommerce React

The shop's three web apps written in React. They are a port of the Angular apps in [`eCommerce`](../eCommerce) and talk to
the same API, so they work with either backend:

| App | Port (dev) | What it is |
|---|---|---|
| `apps/storefront` | 5173 | The shop: catalog, search, product, cart, checkout, orders, account, returns, support |
| `apps/admin` | 5174 | The back office: products, orders, inventory, returns, promotions, analytics, marketplace, content, users |
| `apps/seller` | 5175 | The seller portal: apply, list products, ship orders, see payouts |

| Backend | Where | Choose it with |
|---|---|---|
| Built-in mock data in the browser (default) | nothing to run | `VITE_BACKEND=mock` |
| NestJS API ([`eCommerce-api`](../eCommerce-api)) | `http://localhost:3333` | `VITE_BACKEND=nest` |
| Go API ([`eCommerce-go`](../eCommerce-go)) | `http://localhost:3334` | `VITE_BACKEND=go` |

`VITE_API_BASE_URL` overrides the address. Both real backends serve the same API on the same databases, so nothing else changes
between them. With a real backend, sign-in, the catalog, cart, checkout and orders (and, in the admin app, product and order
management) use the API; screens whose server side does not exist yet in either backend (returns, promotions, recommendations,
analytics, marketplace, content) keep using the mock data, exactly as in the Angular apps.

## Run it

```bash
pnpm install
pnpm start:storefront                      # mock data, http://localhost:5173
VITE_BACKEND=go pnpm start:storefront      # against the Go API
pnpm start:admin                           # http://localhost:5174  (demo staff: admin@shop.test / Admin@1234)
pnpm start:seller                          # http://localhost:5175  (demo seller: seller@shop.test / Seller@1234)
```

On Windows PowerShell set the variable first: `$env:VITE_BACKEND = 'go'`. The API must allow the app's origin in its
`CORS_ORIGINS` (the compose files in `eCommerce-go` already list ports 5173 to 5175 and 4100 to 4102).

## Check it

```bash
pnpm verify        # lint, typecheck, test and build everything (what CI runs)
pnpm test          # tests only
```

The tests render the real routes on the mock backend with Testing Library, and check accessibility with axe on the main pages.
They are the Angular flow tests carried over: storefront 101, admin 37, seller 5, plus the package suites (core 12, data-access
244, ui 90).

## Production images

Each app is a static site served by nginx (no server-side rendering, see below):

```bash
docker compose up --build -d     # storefront :4100, admin :4101, seller :4102, using the Go API on :3334
BACKEND=nest API_ORIGIN=http://localhost:3333 docker compose up --build -d
```

The API address is baked into the bundle at build time and also allowed in the page's Content-Security-Policy at start-up. The
containers run read-only, without capabilities, as an unprivileged user.

## Layout

```
packages/core         dependency injection, signals, React hooks (useService, useSignal, useResource), i18n, SEO, consent, theme
packages/data-access  the API contracts, the mock backends, and the HTTP adapters for the real API
packages/state        auth, cart and notification stores, route guards
packages/ui           design tokens, components, form helpers, test helpers (@shop/ui/testing)
apps/*                the three apps (routes, pages, config)
```

Packages only depend downward (`core` <- `data-access`, `ui` <- `state` <- apps) and apps never import each other; ESLint
enforces both.

## How it relates to the Angular apps

The business logic was kept, not rewritten: `data-access` (about 9,000 lines of mock backends and HTTP adapters), the stores and
the pricing/validation rules are the same code. `packages/core` supplies small stand-ins for Angular's `inject()`,
`@Injectable` and signals so that code runs unchanged; components were rewritten from the Angular templates with the same
Tailwind classes, so the apps look and behave the same.

Known differences:

- **No server-side rendering.** The Angular storefront rendered on the server for search engines. These are single-page apps; if
  SEO matters, put a prerender step or an SSR framework in front of the storefront.
- **Forms** use a small `useForm` helper in `@shop/ui` instead of Angular reactive forms; messages and rules are the same.
- **Order tracking** polls every 15 seconds, as in the Angular app (the Go API also offers a server-sent-events stream that
  neither frontend uses yet).
