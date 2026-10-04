import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { ContentBanner, HomeSection, ManagedPage, NavLink, Redirect } from '@ecom/contracts';
import { htmlToSource } from '@shop/core';
import pages from './data/cms-pages.json';
import home from './data/home.json';

interface ContentState {
  banners: ContentBanner[] | null;
  sections: HomeSection[] | null;
  pages: Record<string, ManagedPage>;
  deletedPages: string[];
  links: NavLink[] | null;
  redirects: Redirect[];
}

const KEY = 'ecom.mock.content.v1';
const SEED_TIME = '2026-09-01T00:00:00.000Z';
const LOCKED = new Set(['terms', 'privacy']);

export const DEFAULT_SECTIONS: HomeSection[] = [
  { key: 'categories', title: 'Shop by category', enabled: true, order: 1 },
  { key: 'deals', title: "Today's deals", enabled: true, order: 2 },
  { key: 'featured', title: 'Featured for you', enabled: true, order: 3 },
  { key: 'new', title: 'New arrivals', enabled: true, order: 4 },
  { key: 'best', title: 'Top rated', enabled: true, order: 5 },
  { key: 'brands', title: 'Popular brands', enabled: true, order: 6 },
  { key: 'recent', title: 'Recently viewed', enabled: true, order: 7 },
];

export const DEFAULT_LINKS: NavLink[] = [
  { id: 'lnk-1', label: 'About us', href: '/pages/about', group: 'about', order: 1 },
  { id: 'lnk-2', label: 'Contact us', href: '/pages/contact', group: 'about', order: 2 },
  { id: 'lnk-3', label: 'FAQ', href: '/pages/faq', group: 'help', order: 1 },
  { id: 'lnk-4', label: 'Track order', href: '/orders', group: 'help', order: 2 },
  { id: 'lnk-5', label: 'Terms and conditions', href: '/pages/terms', group: 'legal', order: 1 },
  { id: 'lnk-6', label: 'Privacy policy', href: '/pages/privacy', group: 'legal', order: 2 },
  { id: 'lnk-7', label: 'Personalisation and privacy', href: '/personalisation', group: 'legal', order: 3 },
];

const seededBanners = (): ContentBanner[] => (home.banners as ContentBanner[]).map((b, i) => ({ ...b, active: true, order: i + 1 }));

const seededPages = (): ManagedPage[] =>
  (pages as { slug: string; title: string; body: string; seo?: { title?: string; description?: string } }[]).map((p) => ({
    slug: p.slug,
    title: p.title,
    body: p.body,
    source: htmlToSource(p.body),
    status: 'published' as const,
    ...(p.seo?.title ? { seoTitle: p.seo.title } : {}),
    ...(p.seo?.description ? { seoDescription: p.seo.description } : {}),
    updatedAt: SEED_TIME,
    locked: LOCKED.has(p.slug),
  }));

/** Content storage shared by the storefront and admin mock adapters (device-local; a real backend keeps this in a database). */
@Injectable({ providedIn: 'root' })
export class MockContentStore {
  private readonly storage = inject(STORAGE);

  private read(): ContentState {
    try {
      const raw = this.storage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<ContentState>) : {};
      return { banners: parsed.banners ?? null, sections: parsed.sections ?? null, pages: parsed.pages ?? {}, deletedPages: parsed.deletedPages ?? [], links: parsed.links ?? null, redirects: parsed.redirects ?? [] };
    } catch {
      return { banners: null, sections: null, pages: {}, deletedPages: [], links: null, redirects: [] };
    }
  }

  private update(change: (s: ContentState) => void): void {
    const state = this.read();
    change(state);
    try {
      this.storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked.
    }
  }

  banners(): ContentBanner[] {
    return [...(this.read().banners ?? seededBanners())].sort((a, b) => a.order - b.order);
  }
  setBanners(banners: ContentBanner[]): void {
    this.update((s) => (s.banners = banners));
  }

  sections(): HomeSection[] {
    return [...(this.read().sections ?? DEFAULT_SECTIONS)].sort((a, b) => a.order - b.order);
  }
  setSections(sections: HomeSection[]): void {
    this.update((s) => (s.sections = sections));
  }

  pages(): ManagedPage[] {
    const s = this.read();
    const deleted = new Set(s.deletedPages);
    const merged = new Map<string, ManagedPage>(seededPages().filter((p) => !deleted.has(p.slug)).map((p) => [p.slug, p]));
    for (const p of Object.values(s.pages)) merged.set(p.slug, p);
    return [...merged.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }
  savePage(page: ManagedPage): void {
    this.update((s) => {
      s.pages[page.slug] = page;
      s.deletedPages = s.deletedPages.filter((d) => d !== page.slug);
    });
  }
  deletePage(slug: string): void {
    this.update((s) => {
      delete s.pages[slug];
      if (!s.deletedPages.includes(slug)) s.deletedPages.push(slug);
    });
  }

  links(): NavLink[] {
    return [...(this.read().links ?? DEFAULT_LINKS)].sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order);
  }
  setLinks(links: NavLink[]): void {
    this.update((s) => (s.links = links));
  }

  redirects(): Redirect[] {
    return this.read().redirects;
  }
  setRedirects(redirects: Redirect[]): void {
    this.update((s) => (s.redirects = redirects));
  }
}
