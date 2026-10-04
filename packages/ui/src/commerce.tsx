import { Link, useSearchParams } from 'react-router';
import type { AppliedCoupon, AppliedPromotion, CartLine as CartLineModel, CartTotals, Money, ProductSummary } from '@ecom/contracts';
import { discountPercent, useDate, useMoney, useT } from '@shop/core';
import { Badge, Icon, QuantityStepper, Rating, cx } from './basics';

/** Selling price with optional struck-through MRP and % off. Always use this for showing prices. */
export function Price({ price, mrp }: { price: Money; mrp?: Money }) {
  const t = useT();
  const money = useMoney();
  const percent = discountPercent(price, mrp);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="text-lg font-semibold text-text">{money(price)}</span>
      {percent > 0 && (
        <>
          <span className="text-sm text-text-muted line-through">
            <span className="sr-only">{t('common.mrp')} </span>
            {money(mrp)}
          </span>
          <span className="text-sm font-semibold text-success">{t('common.percentOff', { percent })}</span>
        </>
      )}
    </span>
  );
}

/**
 * Product tile. The whole card is one link target (the title link is stretched over the card); the wishlist, compare and
 * quick-add controls sit above it.
 */
export function ProductCard({
  product,
  wishlisted = false,
  comparing = false,
  showQuickAdd = true,
  priority = false,
  onWishlistToggle,
  onCompareToggle,
  onQuickAdd,
}: {
  product: ProductSummary;
  wishlisted?: boolean;
  comparing?: boolean;
  showQuickAdd?: boolean;
  /** Mark the first row's images as high priority for LCP. */
  priority?: boolean;
  onWishlistToggle?: () => void;
  onCompareToggle?: () => void;
  onQuickAdd?: () => void;
}) {
  const t = useT();
  const percent = discountPercent(product.priceMin, product.mrpMin);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card transition-shadow hover:shadow-popover">
      <div className="relative aspect-square overflow-hidden bg-surface-alt">
        <img
          src={product.image.url}
          width={product.image.width}
          height={product.image.height}
          alt={product.image.alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          className="size-full object-cover"
        />
        {product.hoverImage && (
          <img
            src={product.hoverImage.url}
            width={product.hoverImage.width}
            height={product.hoverImage.height}
            alt=""
            loading="lazy"
            className="absolute inset-0 hidden size-full object-cover opacity-0 transition-opacity duration-250 group-hover:opacity-100 md:block"
          />
        )}
        <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
          {percent > 0 && <Badge tone="sale">{t('common.percentOff', { percent })}</Badge>}
          {product.stockStatus === 'out_of_stock' ? (
            <Badge tone="danger">{t('card.outOfStock')}</Badge>
          ) : product.stockStatus === 'backorder' ? (
            <Badge tone="warning">{t('card.backorder')}</Badge>
          ) : product.stockStatus === 'low_stock' ? (
            <Badge tone="warning">{t('card.onlyLeft', { n: product.stockLeft })}</Badge>
          ) : null}
        </div>
        <button
          type="button"
          className="absolute end-2 top-2 z-10 inline-flex size-11 items-center justify-center rounded-full bg-surface/90 shadow-card hover:bg-surface"
          aria-pressed={wishlisted}
          aria-label={t(wishlisted ? 'card.removeWishlist' : 'card.addWishlist', { title: product.title })}
          onClick={onWishlistToggle}
        >
          <Icon name="heart" size={22} className={wishlisted ? 'text-sale' : ''} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{product.brandName}</p>
        <h3 className="line-clamp-2 min-h-10 text-sm font-medium text-text">
          <Link to={`/p/${product.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:text-primary">
            {product.title}
          </Link>
        </h3>
        {product.rating.count > 0 && <Rating value={product.rating.average} count={product.rating.count} size={14} />}
        <div className="mt-auto pt-1">
          {product.priceMin.amount !== product.priceMax.amount && <span className="me-1 text-xs text-text-muted">{t('card.from')}</span>}
          <Price price={product.priceMin} mrp={product.mrpMin} />
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" className="size-4 accent-primary" checked={comparing} onChange={onCompareToggle} />
          {t('card.compare')}
        </label>
        {showQuickAdd && product.quickAddVariantId && (
          <button type="button" className="min-h-11 rounded-md px-3 text-sm font-semibold text-primary hover:bg-surface-alt" onClick={onQuickAdd}>
            {t('card.addToCart')}
          </button>
        )}
      </div>
    </article>
  );
}

/** Price breakdown for a cart or an order. All figures come from the server; nothing is computed here. */
export function OrderSummary({ totals, coupon, promotions }: { totals: CartTotals; coupon?: AppliedCoupon; promotions?: AppliedPromotion[] }) {
  const t = useT();
  const money = useMoney();
  const paid = !!(totals.giftCardApplied || totals.creditApplied);
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt>{t('summary.items', { count: totals.itemCount })}</dt>
        <dd>{money(totals.subtotal)}</dd>
      </div>
      {totals.mrpSavings.amount > 0 && (
        <div className="flex justify-between text-success">
          <dt>{t('summary.mrpSavings')}</dt>
          <dd>{money(totals.mrpSavings)}</dd>
        </div>
      )}
      {promotions && promotions.length > 0
        ? promotions.map((offer) => (
            <div key={offer.promotionId} className="flex justify-between gap-3 text-success">
              <dt>
                {offer.name}
                <span className="block text-xs text-text-muted">{offer.label}</span>
              </dt>
              <dd className="shrink-0">−{money(offer.amount)}</dd>
            </div>
          ))
        : totals.promotionDiscount && (
            <div className="flex justify-between text-success">
              <dt>{t('summary.offers')}</dt>
              <dd>−{money(totals.promotionDiscount)}</dd>
            </div>
          )}
      {coupon && (
        <div className="flex justify-between text-success">
          <dt>{t('summary.coupon', { code: coupon.code })}</dt>
          <dd>−{money(totals.couponDiscount)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt>{t('summary.shipping')}</dt>
        <dd>{totals.shipping.amount === 0 ? t('summary.free') : money(totals.shipping)}</dd>
      </div>
      {totals.giftCardApplied && (
        <div className="flex justify-between text-success">
          <dt>{t('summary.giftCard')}</dt>
          <dd>−{money(totals.giftCardApplied)}</dd>
        </div>
      )}
      {totals.creditApplied && (
        <div className="flex justify-between text-success">
          <dt>{t('summary.credit')}</dt>
          <dd>−{money(totals.creditApplied)}</dd>
        </div>
      )}
      <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
        <dt>{paid ? t('summary.toPay') : t('summary.total')}</dt>
        <dd>{money(totals.total)}</dd>
      </div>
      <div className="flex justify-between text-xs text-text-muted">
        <dt>{t('summary.gst')}</dt>
        <dd>{money(totals.taxIncluded)}</dd>
      </div>
    </dl>
  );
}

/** One cart line: image, title, chosen options, price, quantity controls (optional) and remove. */
export function CartLine({ line, compact = false, editable = true, onQuantityChange, onRemove }: { line: CartLineModel; compact?: boolean; editable?: boolean; onQuantityChange?: (quantity: number) => void; onRemove?: () => void }) {
  const t = useT();
  const money = useMoney();
  const date = useDate();
  const options = Object.values(line.options).join(' · ');
  return (
    <div className="block">
      <div className="flex gap-3">
        <Link to={`/p/${line.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <img src={line.image.url} width={line.image.width} height={line.image.height} alt="" loading="lazy" className={cx('rounded-md object-cover', compact ? 'size-16' : 'size-20 md:size-24')} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-text-muted">{line.brandName}</p>
          <Link to={`/p/${line.slug}`} className="line-clamp-2 font-medium hover:text-primary">
            {line.title}
          </Link>
          {options && <p className="text-sm text-text-muted">{options}</p>}
          {line.issue === 'out_of_stock' ? (
            <p className="mt-1 text-sm font-medium text-danger" role="alert">
              {t('cartLine.outOfStock')}
            </p>
          ) : (
            <>
              {line.issue === 'price_changed' && line.previousUnitPrice ? (
                <p className="mt-1 text-sm text-warning">{t('cartLine.priceUpdated', { price: money(line.previousUnitPrice) })}</p>
              ) : line.issue === 'quantity_reduced' ? (
                <p className="mt-1 text-sm text-warning">{t('cartLine.qtyReduced')}</p>
              ) : null}
              {line.backorder && <p className="mt-1 text-sm text-warning">{line.backorder.expectedDate ? t('cartLine.backorderDate', { date: date(line.backorder.expectedDate, 'd MMM y') }) : t('cartLine.backorder')}</p>}
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <Price price={line.unitPrice} mrp={line.mrp} />
                {editable ? (
                  <QuantityStepper value={line.quantity} max={line.maxQuantity} label={t('qty.of', { title: line.title })} onChange={(q) => onQuantityChange?.(q)} />
                ) : (
                  <span className="text-sm text-text-muted">{t('qty.short', { n: line.quantity })}</span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between">
          {line.issue !== 'out_of_stock' && <p className="font-semibold">{money(line.lineTotal)}</p>}
          {editable && (
            <button type="button" className="min-h-11 text-sm font-medium text-danger hover:underline" onClick={onRemove}>
              {t('common.remove')}
              <span className="sr-only"> {line.title}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type PageItem = number | 'gap';

/** Builds a compact page list such as 1 … 4 5 6 … 20. Pure so it can be unit tested. */
export function pageItems(page: number, pages: number): PageItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pages - 1) items.push('gap');
  items.push(pages);
  return items;
}

/** Crawlable page links: each page is a real link that merges `?page=n` into the current query. */
export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useT();
  const [params] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === 1) next.delete('page');
    else next.set('page', String(n));
    const query = next.toString();
    return query ? `?${query}` : '?';
  };
  const linkClass = 'inline-flex min-h-11 items-center rounded-md px-3 hover:bg-surface-alt';
  return (
    <nav aria-label={t('common.pagination')}>
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          {page > 1 && (
            <Link to={href(page - 1)} rel="prev" className={linkClass}>
              {t('common.previous')}
            </Link>
          )}
        </li>
        {pageItems(page, pages).map((item, i) => (
          <li key={`${item}-${i}`}>
            {item === 'gap' ? (
              <span className="px-2 text-text-muted" aria-hidden="true">
                …
              </span>
            ) : (
              <Link
                to={href(item)}
                className={cx('inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-alt', item === page && 'bg-primary font-semibold text-primary-contrast hover:bg-primary')}
                aria-current={item === page ? 'page' : undefined}
                aria-label={t('common.page', { n: item })}
              >
                {item}
              </Link>
            )}
          </li>
        ))}
        <li>
          {page < pages && (
            <Link to={href(page + 1)} rel="next" className={linkClass}>
              {t('common.next')}
            </Link>
          )}
        </li>
      </ul>
    </nav>
  );
}
