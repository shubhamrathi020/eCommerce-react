# eCommerce React: Claude Instructions

The React version of the shop's three web apps (storefront, admin, seller). A port of the Angular apps in the sibling repository
`eCommerce`, which also holds the requirements (`brds/`, see BRD 26), the project log and the steering docs for the whole
project. Solo project; the user pushes (never run `git push`).

## Sibling repositories
- `eCommerce`: the Angular apps, requirements, project log, steering docs. Read `steering/rules.md` there before a big task.
- `eCommerce-api`: NestJS backend; owns the PostgreSQL schema and migrations.
- `eCommerce-go`, `eCommerce-node`, `eCommerce-dotnet`: Go, Node and .NET backends with the same API on the same databases (ports 3334, 3335, 3336).
- `eCommerce-contracts`: `@ecom/contracts`, the shared types and pure rules (installed from GitHub at a tagged version). A shape
  or rule both sides use is changed there first.

## Rules of this repository
- Keep behaviour identical to the Angular apps. When a screen differs, fix the React side unless the Angular app is the bug.
- Prices and rules come from `@ecom/contracts` and the API. Never recompute money in a component.
- Layering is enforced by ESLint: `core` <- `data-access`, `ui` <- `state` <- apps; apps never import each other.
- A new screen gets a test in its app that drives it like a user and runs axe (`@shop/ui/testing`: `settle`, `fill`, `click`,
  `violations`). Use the app's `test-harness.tsx` (`open`/`setup`).
- Commit after each finished unit. Never push. Files containing apostrophes in shell heredocs break the tool; use the editor
  tools for those.

## Commands
- `pnpm verify` runs lint, typecheck, tests and build (CI does the same). Storefront tests take a few minutes (axe on large pages).
- `pnpm start:storefront|admin|seller`; `VITE_BACKEND=mock|nest|go|node|dotnet` chooses the backend.
- `docker compose up --build -d` builds and runs the three production images.

## Lessons
- Do not recreate the Angular `ParamMap`/`FormGroup` shapes; `useListParams` (admin) and `useForm` (`@shop/ui`) cover them.
- Route guards that redirect (`CartNotEmpty`) must decide once on entry; re-checking on every cart change bounced shoppers away
  from their order confirmation.
- Real backends run only with the right CORS origins and, for online payment, Razorpay test keys; without keys the API answers
  "Online payment is not set up" by design.
- jsdom has no layout: stub `scrollTo`, and run axe on one big page per test with a long timeout.
- nginx with a read-only root filesystem needs tmpfs mounts for `/etc/nginx/conf.d` (envsubst writes there) and `/var/cache/nginx`.
