import type { Banner, Brand, Category, Collection, HomeData, Product } from '@ecom/contracts';
import { computeServiceability } from '@ecom/contracts';
import type { CatalogData } from './catalog-engine';

export { computeServiceability };

export interface HomeFile {
  banners: Banner[];
  categoryTiles: HomeData['categoryTiles'];
}

export type LoadedCatalog = CatalogData & { home: HomeFile };

let dataPromise: Promise<LoadedCatalog> | undefined;

/**
 * Lets another mock store reshape the catalog every shop and cart read goes through (BRD 17: marketplace products that an
 * admin approved, and which seller owns what). One slot, replaced on each registration, so tests that rebuild the injector
 * never stack stale handlers. `undefined` means "the catalog as shipped".
 */
let extension: ((products: Product[], categories: Category[]) => Product[]) | undefined;
export function registerCatalogExtension(fn: ((products: Product[], categories: Category[]) => Product[]) | undefined): void {
  extension = fn;
}

/** JSON fixtures are loaded lazily so they never weigh down the initial bundle. */
export async function loadCatalogData(): Promise<LoadedCatalog> {
  dataPromise ??= Promise.all([import('./data/products.json'), import('./data/categories.json'), import('./data/brands.json'), import('./data/collections.json'), import('./data/home.json')]).then(
    ([products, categories, brands, collections, home]) => ({
      products: products.default as unknown as Product[],
      categories: categories.default as unknown as Category[],
      brands: brands.default as Brand[],
      collections: collections.default as Collection[],
      home: home.default as unknown as HomeFile,
    }),
  );
  const base = await dataPromise;
  return extension ? { ...base, products: extension(base.products, base.categories) } : base;
}

/** Public URLs for the sitemap (products, categories, brands, collections and published pages). */
export async function loadSitemapSource() {
  const [{ products, categories, brands, collections }, pages] = await Promise.all([loadCatalogData(), import('./data/cms-pages.json')]);
  return {
    products: products.map((p) => ({ slug: p.slug, createdAt: p.createdAt })),
    categories: categories.map((c) => ({ slug: c.slug })),
    brands: brands.map((b) => ({ slug: b.slug })),
    collections: collections.map((c) => ({ slug: c.slug })),
    pages: (pages.default as { slug: string }[]).map((p) => ({ slug: p.slug })),
  };
}
