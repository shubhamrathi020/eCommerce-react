export interface SitemapSource {
  products: { slug: string; createdAt: string }[];
  categories: { slug: string }[];
  brands: { slug: string }[];
  collections: { slug: string }[];
  pages: { slug: string }[];
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Paths that must never be indexed: private, transactional or duplicate views. */
export const DISALLOWED_PATHS = ['/account', '/cart', '/checkout', '/orders', '/wishlist', '/compare', '/search', '/dev'];

export function buildRobotsTxt(baseUrl: string): string {
  return ['User-agent: *', ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`), 'Allow: /', '', `Sitemap: ${baseUrl.replace(/\/$/, '')}/sitemap.xml`, ''].join('\n');
}

/** Sitemap of every public, indexable URL (filtered and searched views are excluded on purpose). */
export function buildSitemapXml(baseUrl: string, source: SitemapSource): string {
  const base = baseUrl.replace(/\/$/, '');
  const urls: { path: string; lastmod?: string; priority: string }[] = [
    { path: '/', priority: '1.0' },
    ...source.categories.map((c) => ({ path: `/c/${c.slug}`, priority: '0.8' })),
    ...source.brands.map((b) => ({ path: `/b/${b.slug}`, priority: '0.5' })),
    ...source.collections.map((c) => ({ path: `/collections/${c.slug}`, priority: '0.6' })),
    ...source.pages.map((p) => ({ path: `/pages/${p.slug}`, priority: '0.4' })),
    ...source.products.map((p) => ({ path: `/p/${p.slug}`, lastmod: p.createdAt.slice(0, 10), priority: '0.7' })),
  ];
  const body = urls.map((u) => `  <url><loc>${xml(base + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
