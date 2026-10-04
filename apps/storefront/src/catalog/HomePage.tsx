import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Banner, ProductRow as ProductRowData, ProductSummary } from '@ecom/contracts';
import { SeoService, useResource, useService } from '@shop/core';
import { CatalogApi, ContentApi } from '@shop/data-access';
import { Countdown, ErrorState, Icon, Skeleton, cx } from '@shop/ui';
import { DealsStrip, HomeRecos, ProductRow, RecentlyViewed } from './ProductRows';

const rowItems = (rows: ProductRowData[], key: string): ProductSummary[] => rows.find((r) => r.key === key)?.items ?? [];

/** Autoplaying banner carousel. Pauses on hover/focus and never autoplays with reduced motion. */
export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = banners.length;

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || paused || n < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % n), 6000);
    return () => clearInterval(id);
  }, [paused, n]);

  const step = (delta: number) => setIndex((i) => (i + delta + n) % n);
  const arrow = 'absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 shadow-card hover:bg-surface';
  return (
    <section
      className="relative overflow-hidden rounded-lg bg-surface-alt"
      aria-roledescription="carousel"
      aria-label="Featured offers"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {banners.map(
        (banner, i) =>
          i === index && (
            <div key={banner.id} className="relative" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`}>
              <img src={banner.image.url} width={banner.image.width} height={banner.image.height} alt={banner.image.alt} fetchPriority={i === 0 ? 'high' : undefined} className="aspect-[16/9] w-full object-cover md:aspect-[1600/560]" />
              <div className="absolute inset-0 flex flex-col justify-center gap-2 p-5 text-white md:gap-3 md:p-12">
                <h2 className="max-w-md text-2xl font-bold drop-shadow md:text-4xl">{banner.title}</h2>
                <p className="max-w-md text-sm drop-shadow md:text-lg">{banner.subtitle}</p>
                <Link to={banner.link} className="mt-1 inline-flex min-h-11 w-fit items-center rounded-md bg-white px-5 font-semibold text-[#4338ca] hover:bg-surface-alt">
                  {banner.cta}
                </Link>
              </div>
            </div>
          ),
      )}
      {n > 1 && (
        <>
          <button type="button" className={cx(arrow, 'start-2')} aria-label="Previous slide" onClick={() => step(-1)}>
            <Icon name="chevron-right" className="rotate-180" />
          </button>
          <button type="button" className={cx(arrow, 'end-2')} aria-label="Next slide" onClick={() => step(1)}>
            <Icon name="chevron-right" />
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {banners.map((banner, i) => (
              <button key={banner.id} type="button" className="inline-flex size-6 items-center justify-center" aria-label={`Go to slide ${i + 1}`} aria-current={i === index ? 'true' : undefined} onClick={() => setIndex(i)}>
                <span className={cx('size-2.5 rounded-full', i === index ? 'bg-white' : 'bg-white/50')} />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function HomePage() {
  const catalog = useService(CatalogApi);
  const contentApi = useService(ContentApi);
  const seo = useService(SeoService);
  const home = useResource(() => catalog.home(), [catalog]);
  // Banners and section order come from the content service, so staff can change them without a release.
  const config = useResource(() => contentApi.homeConfig(), [contentApi]);
  const sections = config.value?.sections ?? [];
  const [recosReady, setRecosReady] = useState(false);

  useEffect(() => {
    seo.set({ title: 'Fashion, electronics, groceries and more', description: 'Shop fashion, electronics, groceries, home, beauty and more with fast delivery and easy returns.', path: '/' });
  }, [seo]);

  // Recommendations load once the browser is idle, so they never delay the main content.
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const id = idle ? idle(() => setRecosReady(true)) : window.setTimeout(() => setRecosReady(true), 200);
    return () => {
      if (!idle) clearTimeout(id);
    };
  }, []);

  const data = home.value;
  return (
    <>
      <h1 className="sr-only">Shop: fashion, electronics, groceries and more</h1>
      {home.status === 'loading' && (
        <>
          <Skeleton className="aspect-[16/9] w-full md:aspect-[1600/560]" />
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-32" />
            ))}
          </div>
        </>
      )}
      {home.status === 'error' && <ErrorState onRetry={home.reload} />}
      {home.status === 'ready' && data && (
        <div className="space-y-10">
          {config.value && config.value.banners.length > 0 && <HeroCarousel banners={config.value.banners} />}
          <DealsStrip />
          {recosReady && <HomeRecos />}
          {sections.map((section) => {
            switch (section.key) {
              case 'categories':
                return (
                  <section key={section.key} aria-label="Shop by category">
                    <h2 className="mb-3 text-xl font-semibold md:text-2xl">{section.title}</h2>
                    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {data.categoryTiles.map((tile) => (
                        <li key={tile.slug}>
                          <Link to={`/c/${tile.slug}`} className="group relative block overflow-hidden rounded-lg">
                            <img src={tile.image.url} width={tile.image.width} height={tile.image.height} alt="" className="aspect-[3/2] w-full object-cover transition-transform duration-250 group-hover:scale-105" />
                            <span className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 font-semibold text-white">{tile.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              case 'deals':
                return (
                  data.deals.items.length > 0 && (
                    <section key={section.key} aria-label={section.title} className="rounded-lg bg-surface-alt p-4 md:p-6">
                      <p className="mb-3 text-sm">
                        <span className="text-lg font-semibold md:text-2xl">{section.title}</span>
                        <span className="ms-3 text-text-muted">
                          Ends in <Countdown endsAt={data.deals.endsAt} />
                        </span>
                      </p>
                      <ProductRow title="Deals on top picks" items={data.deals.items} />
                    </section>
                  )
                );
              case 'featured':
                return <ProductRow key={section.key} title={section.title} items={rowItems(data.rows, 'featured')} />;
              case 'new':
                return <ProductRow key={section.key} title={section.title} items={rowItems(data.rows, 'new')} link="/collections/trending" />;
              case 'best':
                return <ProductRow key={section.key} title={section.title} items={rowItems(data.rows, 'best')} />;
              case 'brands':
                return (
                  <section key={section.key} aria-label="Popular brands">
                    <h2 className="mb-3 text-xl font-semibold md:text-2xl">{section.title}</h2>
                    <ul className="flex flex-wrap gap-2">
                      {data.brands.map((brand) => (
                        <li key={brand.id}>
                          <Link to={`/b/${brand.slug}`} className="inline-flex min-h-11 items-center rounded-full border border-border-strong px-4 text-sm font-medium hover:bg-surface-alt">
                            {brand.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              case 'recent':
                return <RecentlyViewed key={section.key} />;
              default:
                return null;
            }
          })}
        </div>
      )}
    </>
  );
}
