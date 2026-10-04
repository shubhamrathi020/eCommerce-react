import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import DOMPurify from 'dompurify';
import { firstValueFrom } from 'rxjs';
import { ApiException, type AlertKind, type AttributeDef, type CategoryNode, type Product, type Variant } from '@ecom/contracts';
import { AnalyticsService, BottomBarService, CART_FACADE, CompareStore, ConsentService, RecentlyViewedStore, SeoService, ToastService, WishlistStore, useDate, useResource, useService, useSignal } from '@shop/core';
import { AlertApi, CatalogApi, CategoryApi, LOW_STOCK_THRESHOLD } from '@shop/data-access';
import { AuthStore } from '@shop/state';
import { Badge, Breadcrumb, Button, ErrorState, Gallery, NotFound, Price, QuantityStepper, Rating, Skeleton, Tabs } from '@shop/ui';
import { DealBanner, ProductRecos, RecentlyViewed } from './ProductRows';
import { DeliveryCheck, SellerCard } from './ProductParts';
import { ReviewsSection } from './Reviews';

type Selection = Record<string, string>;

/** The variant shown when the URL does not name one: the first in stock, else the first. */
const defaultVariant = (p: Product): Variant => p.variants.find((v) => v.stock > 0) ?? p.variants[0];

const flatten = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

/** Product detail page: gallery, variant picker, price/stock, delivery check, tabs, related products. */
export default function ProductPage() {
  const { slug = '' } = useParams();
  const api = useService(CatalogApi);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resource = useResource(() => api.product(slug), [api, slug]);
  const data = resource.value;

  // The old address of a renamed product answers with the new slug: move there without adding a history entry.
  useEffect(() => {
    if (data?.redirectedFrom) navigate({ pathname: `/p/${data.product.slug}`, search: params.toString() ? `?${params}` : '' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (resource.status === 'error' && !data) {
    return resource.error instanceof ApiException && resource.error.code === 'not_found' ? <NotFound /> : <ErrorState onRetry={resource.reload} />;
  }
  if (!data || data.product.slug !== slug) {
    return (
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-square" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }
  // Keyed so the option selection resets when the product changes.
  return <ProductView key={data.product.id} product={data.product} redirecting={!!data.redirectedFrom} />;
}

function ProductView({ product: p, redirecting }: { product: Product; redirecting: boolean }) {
  const categoryApi = useService(CategoryApi);
  const alertApi = useService(AlertApi);
  const seo = useService(SeoService);
  const toast = useService(ToastService);
  const cart = useService(CART_FACADE);
  const wishlist = useService(WishlistStore);
  const compare = useService(CompareStore);
  const recent = useService(RecentlyViewedStore);
  const analytics = useService(AnalyticsService);
  const auth = useService(AuthStore);
  const consent = useService(ConsentService);
  const bottomBar = useService(BottomBarService);
  const date = useDate();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const loggedIn = useSignal(auth.loggedIn);
  const needsDecision = useSignal(consent.needsDecision);
  const wishlistIds = useSignal(wishlist.ids);
  const compareIds = useSignal(compare.ids);

  const [selection, setSelection] = useState<Selection>(() => {
    const wanted = p.variants.find((v) => v.id === params.get('variant'));
    return { ...(wanted ?? defaultVariant(p)).options };
  });
  const [quantity, setQuantity] = useState(1);
  const [alertBusy, setAlertBusy] = useState<AlertKind | null>(null);

  const categories = useResource<CategoryNode[]>(() => categoryApi.tree(), [categoryApi]);
  const alerts = useResource(() => alertApi.list(), [alertApi, loggedIn], loggedIn);

  const variant = p.variants.find((v) => p.variantAxes.every((axis) => v.options[axis] === selection[axis]));
  const images = variant?.images ?? p.images;
  const maxQuantity = variant?.backorder ? 10 : Math.max(1, Math.min(10, variant?.stock ?? 1));
  const canBuy = (variant?.stock ?? 0) > 0 || !!variant?.backorder;
  const wishlisted = wishlistIds.includes(p.id);
  const comparing = compareIds.includes(p.id);

  const attributeDefs = useMemo<AttributeDef[]>(() => (categories.value ? (flatten(categories.value).find((c) => c.id === p.categoryId)?.attributeDefs ?? []) : []), [categories.value, p.categoryId]);
  const specs = useMemo(() => {
    const defs = new Map(attributeDefs.map((d) => [d.key, d]));
    return [{ label: 'Brand', value: p.brandName }, ...Object.entries(p.attributes).map(([key, value]) => ({ label: defs.get(key)?.label ?? key, value: String(value) }))];
  }, [attributeDefs, p]);
  const crumbs = [{ label: 'Home', link: '/' }, ...p.categoryPath.map((c) => ({ label: c.name, link: `/c/${c.slug}` })), { label: p.title }];

  // Tells the compare bar to get out of the way on mobile while this page's own sticky bar is showing.
  useEffect(() => {
    bottomBar.setPrimaryActionVisible(!needsDecision);
    return () => bottomBar.setPrimaryActionVisible(false);
  }, [bottomBar, needsDecision]);

  useEffect(() => {
    recent.add(p.id);
    // Behaviour event: recorded only with consent and never while opted out; no personal data.
    analytics.track({ name: 'product_view', props: { productId: p.id, categoryId: p.categoryId } });
  }, [p.id, p.categoryId, recent, analytics]);

  const sku = variant?.sku;
  useEffect(() => {
    const stock = p.variants.some((x) => x.stock > 0);
    const prices = p.variants.map((x) => x.price.amount);
    seo.set({
      title: p.seo?.title ?? p.title,
      description: p.seo?.description ?? `${p.title} by ${p.brandName}. ${p.highlights.slice(0, 3).join(', ')}.`,
      path: `/p/${p.slug}`,
      image: p.images[0]?.url,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Product',
            name: p.title,
            sku,
            brand: { '@type': 'Brand', name: p.brandName },
            image: p.images.map((i) => i.url),
            description: p.highlights.join('. '),
            ...(p.rating.count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating.average, reviewCount: p.rating.count } } : {}),
            offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: Math.min(...prices) / 100, highPrice: Math.max(...prices) / 100, offerCount: p.variants.length, availability: stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
          },
          { '@type': 'BreadcrumbList', itemListElement: p.categoryPath.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `/c/${c.slug}` })) },
        ],
      },
    });
  }, [p, sku, seo]);

  // Keep the chosen variant in the URL (shareable) without adding history entries.
  const variantId = variant?.id;
  useEffect(() => {
    if (!variantId || redirecting || params.get('variant') === variantId) return;
    // Nothing to sync when the default variant is showing and the URL does not name one.
    if (variantId === defaultVariant(p).id && !params.has('variant')) return;
    const next = new URLSearchParams(params);
    next.set('variant', variantId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  // Quantity cannot exceed the stock of the newly selected variant.
  useEffect(() => {
    setQuantity((q) => Math.min(q, maxQuantity));
  }, [maxQuantity]);

  const axisLabel = (axis: string) => attributeDefs.find((d) => d.key === axis)?.label ?? axis.charAt(0).toUpperCase() + axis.slice(1);
  const axisValues = (axis: string): string[] => {
    const def = attributeDefs.find((d) => d.key === axis);
    const present = [...new Set(p.variants.map((v) => v.options[axis]))];
    return def?.values ? def.values.filter((v) => present.includes(v)) : present;
  };
  const optionOutOfStock = (axis: string, value: string) => !p.variants.some((v) => v.options[axis] === value && (v.stock > 0 || v.backorder));
  const optionClass = (axis: string, value: string) => {
    if (selection[axis] === value) return 'border-primary bg-primary text-primary-contrast';
    if (optionOutOfStock(axis, value)) return 'border-border text-text-muted line-through opacity-60';
    return 'border-border-strong hover:bg-surface-alt';
  };

  /** Picks the variant with this option that agrees with the most other current choices, preferring in-stock ones. */
  const choose = (axis: string, value: string) => {
    const score = (v: Variant) => p.variantAxes.filter((a) => a !== axis && v.options[a] === selection[a]).length;
    const best = p.variants.filter((v) => v.options[axis] === value).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || score(b) - score(a))[0];
    if (best) setSelection({ ...best.options });
  };

  const addToCart = () => {
    if (!variant || (variant.stock === 0 && !variant.backorder)) return;
    void cart.add({ productId: p.id, variantId: variant.id, quantity, title: p.title });
  };
  /** Adds the item, then goes straight to checkout. */
  const buyNow = async () => {
    if (!variant || (variant.stock === 0 && !variant.backorder)) return;
    const added = await cart.add({ productId: p.id, variantId: variant.id, quantity, title: p.title, openMiniCart: false });
    if (added) navigate('/checkout');
  };
  const toggleWishlist = () => toast.success(wishlist.toggle(p.id) ? 'Added to your wishlist' : 'Removed from your wishlist');
  const toggleCompare = () => {
    if (compare.has(p.id)) compare.remove(p.id);
    else if (!compare.add(p.id)) toast.error(`You can compare up to ${compare.limit} products. Remove one first.`);
  };

  const isSubscribed = (kind: AlertKind) => !!variant && (alerts.value ?? []).some((a) => a.kind === kind && a.variantId === variant.id);
  const toggleAlert = async (kind: AlertKind, vId: string) => {
    const existing = (alerts.value ?? []).find((a) => a.kind === kind && a.variantId === vId);
    setAlertBusy(kind);
    try {
      if (existing) {
        await firstValueFrom(alertApi.remove(existing.id));
        toast.info('Alert removed');
      } else {
        await firstValueFrom(alertApi.subscribe(kind, vId));
        toast.success(kind === 'back_in_stock' ? "We'll email you when it's back in stock" : "We'll email you if the price drops");
      }
      alerts.reload();
    } catch (e) {
      toast.error(e instanceof ApiException ? e.message : 'Could not save that alert.');
    } finally {
      setAlertBusy(null);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Breadcrumb items={crumbs} />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Gallery images={images} />

        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-text-muted">{p.brandName}</p>
            <h1 className="text-2xl font-bold md:text-3xl">{p.title}</h1>
            {p.rating.count > 0 && (
              <div className="mt-1">
                <Rating value={p.rating.average} count={p.rating.count} size={18} />
              </div>
            )}
          </div>

          {variant && (
            <>
              <div>
                <div className="text-2xl">
                  <Price price={variant.price} mrp={variant.mrp} />
                </div>
                <p className="text-xs text-text-muted">Inclusive of all taxes</p>
              </div>
              <p aria-live="polite">
                {variant.stock === 0 && variant.backorder ? (
                  <>
                    <Badge tone="warning">Backorder</Badge>
                    <span className="ms-2 text-sm">{variant.backorder.expectedDate ? 'Ships around ' + date(variant.backorder.expectedDate, 'd MMM y') : 'Ships when it is back in stock'}</span>
                  </>
                ) : variant.stock === 0 ? (
                  <Badge tone="danger">Out of stock</Badge>
                ) : variant.stock <= LOW_STOCK_THRESHOLD ? (
                  <Badge tone="warning">Only {variant.stock} left</Badge>
                ) : (
                  <Badge tone="success">In stock</Badge>
                )}
                <span className="ms-2 text-sm text-text-muted">SKU {variant.sku}</span>
              </p>
            </>
          )}

          {p.variantAxes.map((axis) => (
            <fieldset key={axis}>
              <legend className="mb-2 text-sm font-medium">
                {axisLabel(axis)}: <span className="font-normal text-text-muted">{selection[axis]}</span>
              </legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={axisLabel(axis)}>
                {axisValues(axis).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    className={`min-h-11 min-w-11 rounded-md border px-3 text-sm font-medium ${optionClass(axis, value)}`}
                    aria-checked={selection[axis] === value}
                    aria-label={value + (optionOutOfStock(axis, value) ? ' (out of stock)' : '')}
                    disabled={optionOutOfStock(axis, value)}
                    onClick={() => choose(axis, value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper value={quantity} onChange={setQuantity} max={maxQuantity} />
            <Button type="button" className="flex-1 md:flex-none" disabled={!canBuy} onClick={addToCart}>
              Add to cart
            </Button>
            <Button variant="secondary" type="button" disabled={!canBuy} onClick={() => void buyNow()}>
              Buy now
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" type="button" aria-pressed={wishlisted} onClick={toggleWishlist}>
              {wishlisted ? 'Saved to wishlist' : 'Add to wishlist'}
            </Button>
            <Button variant="ghost" type="button" aria-pressed={comparing} onClick={toggleCompare}>
              {comparing ? 'Remove from compare' : 'Compare'}
            </Button>
            {loggedIn && variant && (
              <>
                {variant.stock === 0 && !variant.backorder && (
                  <Button variant="ghost" type="button" aria-pressed={isSubscribed('back_in_stock')} loading={alertBusy === 'back_in_stock'} onClick={() => void toggleAlert('back_in_stock', variant.id)}>
                    {isSubscribed('back_in_stock') ? "You'll be notified when it's back" : 'Notify me when back in stock'}
                  </Button>
                )}
                <Button variant="ghost" type="button" aria-pressed={isSubscribed('price_drop')} loading={alertBusy === 'price_drop'} onClick={() => void toggleAlert('price_drop', variant.id)}>
                  {isSubscribed('price_drop') ? "You'll be alerted on a price drop" : 'Alert me on price drop'}
                </Button>
              </>
            )}
          </div>

          <DealBanner productId={p.id} />
          {p.sellerId && <SellerCard sellerId={p.sellerId} />}
          <DeliveryCheck />

          <section aria-label="Offers" className="rounded-lg border border-border p-3 text-sm">
            <h2 className="mb-1 font-semibold">Offers</h2>
            <ul className="list-disc space-y-1 ps-5 text-text-muted">
              <li>Extra 5% off with UPI payments</li>
              <li>Free delivery on orders above ₹499</li>
              <li>Easy 7-day returns on eligible items</li>
            </ul>
          </section>

          {p.highlights.length > 0 && (
            <section aria-label="Highlights">
              <h2 className="mb-1 font-semibold">Highlights</h2>
              <ul className="list-disc space-y-1 ps-5 text-text-muted">
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="mt-10">
        <Tabs
          label="Product information"
          tabs={[
            { label: 'Description', content: <div className="max-w-3xl space-y-3 text-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.description) }} /> },
            {
              label: 'Specifications',
              content: (
                <table className="w-full max-w-3xl text-start text-sm">
                  <caption className="sr-only">Specifications</caption>
                  <tbody className="divide-y divide-border">
                    {specs.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="w-1/3 py-2 pe-4 text-start font-medium text-text-muted">
                          {row.label}
                        </th>
                        <td className="py-2">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ),
            },
            { label: `Reviews (${p.rating.count})`, content: <ReviewsSection productId={p.id} summary={p.rating} /> },
          ]}
        />
      </div>

      <div className="mt-12 space-y-10">
        <ProductRecos productId={p.id} />
        <RecentlyViewed excludeId={p.id} />
      </div>

      {!needsDecision && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-border bg-surface p-3 md:hidden">
          {variant && (
            <div className="flex-1">
              <Price price={variant.price} mrp={variant.mrp} />
            </div>
          )}
          <Button type="button" disabled={!canBuy} onClick={addToCart}>
            Add to cart
          </Button>
        </div>
      )}
    </>
  );
}
