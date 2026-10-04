import { Link } from 'react-router';
import type { ProductSummary, RecRow } from '@ecom/contracts';
import { RecentlyViewedStore, useMoney, useResource, useService, useSignal } from '@shop/core';
import { CatalogApi, PromotionApi, RecommendationApi } from '@shop/data-access';
import { Countdown, ProductCard, Scroller } from '@shop/ui';
import { ShopperActions } from './shopper-actions';

/** A product card wired to the shared wishlist, compare and quick-add actions. */
export function ActionCard({ product, priority = false }: { product: ProductSummary; priority?: boolean }) {
  const actions = useService(ShopperActions);
  const wishlistIds = useSignal(actions.wishlistIds);
  const compareIds = useSignal(actions.compareIds);
  return (
    <ProductCard
      product={product}
      priority={priority}
      wishlisted={wishlistIds.includes(product.id)}
      comparing={compareIds.includes(product.id)}
      onWishlistToggle={() => actions.toggleWishlist(product)}
      onCompareToggle={() => actions.toggleCompare(product)}
      onQuickAdd={() => actions.quickAdd(product)}
    />
  );
}

/** Titled, horizontally scrolling row of product cards. Renders nothing when empty. */
export function ProductRow({ title, items, link }: { title: string; items: ProductSummary[]; link?: string }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold md:text-2xl">{title}</h2>
        {link && (
          <Link to={link} className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        )}
      </div>
      <Scroller label={title}>
        {items.map((product) => (
          <div key={product.id} role="listitem" className="w-44 shrink-0 snap-start md:w-56">
            <ActionCard product={product} />
          </div>
        ))}
      </Scroller>
    </section>
  );
}

/** Strip of the shopper's recently viewed products, optionally excluding the current one. */
export function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const store = useService(RecentlyViewedStore);
  const api = useService(CatalogApi);
  const ids = useSignal(store.ids).filter((id) => id !== excludeId);
  const key = ids.join(',');
  const resource = useResource(() => api.summariesByIds(ids), [api, key], ids.length > 0);
  return <ProductRow title="Recently viewed" items={ids.length ? (resource.value ?? []) : []} />;
}

/** An explainable recommendation row: the title, how it was chosen, and for each product why it is there. */
export function RecoRow({ row }: { row: RecRow | null | undefined }) {
  if (!row) return null;
  return (
    <section aria-label={row.title} data-strategy={row.strategy}>
      <div className="mb-3">
        <h2 className="text-xl font-semibold md:text-2xl">{row.title}</h2>
        {row.subtitle && <p className="text-sm text-text-muted">{row.subtitle}</p>}
      </div>
      <Scroller label={row.title}>
        {row.items.map((item) => (
          <div key={item.product.id} role="listitem" className="w-44 shrink-0 snap-start md:w-56">
            <ActionCard product={item.product} />
            <p className="mt-1 text-xs text-text-muted">{item.reason}</p>
          </div>
        ))}
      </Scroller>
    </section>
  );
}

/** Home page recommendations. Loaded after the main content, so they never delay it. */
export function HomeRecos() {
  const api = useService(RecommendationApi);
  const recs = useResource(() => api.home(), [api]);
  const v = recs.value;
  if (!v) return null;
  return (
    <div className="space-y-10">
      <RecoRow row={v.personalised} />
      <RecoRow row={v.trending} />
      <RecoRow row={v.bestSellers} />
      {(v.personalised || v.trending || v.bestSellers) && (
        <p className="text-sm text-text-muted">
          Rows like these use anonymous browsing activity on this device, only if you accepted analytics.{' '}
          <Link to="/personalisation" className="text-primary underline">
            Change your personalisation choices
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/** Product page recommendations (similar products and frequently bought together). */
export function ProductRecos({ productId }: { productId: string }) {
  const api = useService(RecommendationApi);
  const recs = useResource(() => api.forProduct(productId), [api, productId]);
  if (!recs.value) return null;
  return (
    <>
      <RecoRow row={recs.value.together} />
      <RecoRow row={recs.value.similar} />
    </>
  );
}

/** A live flash deal on a product page: countdown, price and how many are left. The cart applies the price. */
export function DealBanner({ productId }: { productId: string }) {
  const api = useService(PromotionApi);
  const money = useMoney();
  const deal = useResource(() => api.dealFor(productId), [api, productId]);
  const d = deal.value;
  if (!d) return null;
  return (
    <section className="rounded-lg border border-sale p-3 text-sm" aria-label="Flash deal">
      <p className="font-semibold">{d.name}</p>
      <p>
        <strong className="text-base">{money(d.dealPrice)}</strong>
        <span className="ms-1 text-text-muted line-through">
          <span className="sr-only">Regular price </span>
          {money(d.regularPrice)}
        </span>
        <span className="ms-1 text-text-muted">in your cart, up to {d.cap} units</span>
      </p>
      <p className="mt-1">
        Ends in <Countdown endsAt={d.endsAt} /> · <strong>{d.remaining}</strong> of {d.cap} left
      </p>
    </section>
  );
}

/** Live flash deals on the home page. Hidden when there are none. */
export function DealsStrip() {
  const api = useService(PromotionApi);
  const money = useMoney();
  const deals = useResource(() => api.activeDeals(), [api]);
  if (!deals.value?.length) return null;
  return (
    <section aria-labelledby="deals-h" className="rounded-lg border border-sale p-4 md:p-6">
      <h2 id="deals-h" className="mb-3 text-xl font-bold">
        Flash deals
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {deals.value.map((d) => (
          <li key={d.id} className="flex gap-3 rounded-md border border-border p-3">
            <img src={d.image.url} width={72} height={72} alt="" className="size-[4.5rem] shrink-0 rounded-md object-cover" />
            <span className="min-w-0 text-sm">
              <Link to={`/p/${d.slug}`} className="block truncate font-medium hover:text-primary">
                {d.title}
              </Link>
              <span className="block">
                <strong>{money(d.dealPrice)}</strong>{' '}
                <span className="text-text-muted line-through">
                  <span className="sr-only">Regular price </span>
                  {money(d.regularPrice)}
                </span>
              </span>
              <span className="block text-text-muted">
                Ends in <Countdown endsAt={d.endsAt} /> · {d.remaining} left
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
