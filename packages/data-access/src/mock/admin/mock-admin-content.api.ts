import { Injectable, inject } from '@shop/core';
import type { ContentBanner, HomeSection, HomeSectionKey, ManagedPage, NavLink, Redirect } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { renderContent } from '@shop/core';
import { AdminContentApi, type BannerInput, type PageInput } from '../../lib/content.api';
import { MockContentStore } from '../content-store';
import { createMockResponder } from '../mock-latency';
import { normalisePath } from '../mock-content.api';
import { MockAdminState } from './admin-state';

const SECTION_KEYS: HomeSectionKey[] = ['categories', 'deals', 'featured', 'new', 'best', 'brands', 'recent'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['login', 'admin', 'api']);
const MAX_LINKS_PER_GROUP = 8;

const validLink = (href: string): boolean => /^\/(?!\/)[^\s]*$/.test(href) || /^https:\/\/[^\s]+$/i.test(href);
const nowIso = () => new Date().toISOString();
const fail = (fields: Record<string, string>): never => {
  throw new ApiException('validation', 'Please check the highlighted fields.', fields);
};

@Injectable()
export class MockAdminContentApi extends AdminContentApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockContentStore);
  private readonly state = inject(MockAdminState);

  private guard(): void {
    this.state.require('content:write');
  }

  // ---- banners ----
  banners() {
    return this.respond.okAsync<ContentBanner[]>(async () => {
      this.guard();
      return this.store.banners();
    });
  }

  saveBanner(input: BannerInput) {
    return this.respond.okAsync<ContentBanner[]>(async () => {
      this.guard();
      const f: Record<string, string> = {};
      if (!input.title.trim()) f['title'] = 'Title is required';
      else if (input.title.length > 80) f['title'] = 'Keep the title under 80 characters';
      if (input.subtitle.length > 160) f['subtitle'] = 'Keep the subtitle under 160 characters';
      if (!input.cta.trim()) f['cta'] = 'Button text is required';
      if (!validLink(input.link)) f['link'] = 'Use an internal path such as /c/fashion or an https:// address';
      if (!input.image.url.trim() || !(input.image.url.startsWith('/') || input.image.url.startsWith('https://'))) f['imageUrl'] = 'Choose an image (path starting with / or https://)';
      if (!input.image.alt.trim()) f['imageAlt'] = 'Describe the image for screen readers';
      if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) f['endsAt'] = 'The end must be after the start';
      if (Object.keys(f).length) fail(f);

      const all = this.store.banners();
      const existing = input.id ? all.find((b) => b.id === input.id) : undefined;
      if (input.id && !existing) throw new ApiException('not_found', 'Banner not found');
      const banner: ContentBanner = {
        id: existing?.id ?? `banner-${Date.now().toString(36)}`,
        title: input.title.trim(),
        subtitle: input.subtitle.trim(),
        cta: input.cta.trim(),
        link: input.link,
        image: { ...input.image, width: input.image.width || 1600, height: input.image.height || 560 },
        active: input.active,
        ...(input.startsAt ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        order: existing?.order ?? all.length + 1,
      };
      this.store.setBanners(existing ? all.map((b) => (b.id === banner.id ? banner : b)) : [...all, banner]);
      this.state.record(existing ? 'content.banner.update' : 'content.banner.create', banner.title, banner.active ? 'Active' : 'Inactive');
      return this.store.banners();
    });
  }

  deleteBanner(id: string) {
    return this.respond.okAsync<ContentBanner[]>(async () => {
      this.guard();
      const all = this.store.banners();
      const found = all.find((b) => b.id === id);
      if (!found) throw new ApiException('not_found', 'Banner not found');
      this.store.setBanners(all.filter((b) => b.id !== id).map((b, i) => ({ ...b, order: i + 1 })));
      this.state.record('content.banner.delete', found.title, 'Deleted');
      return this.store.banners();
    });
  }

  reorderBanners(ids: string[]) {
    return this.respond.okAsync<ContentBanner[]>(async () => {
      this.guard();
      const all = this.store.banners();
      const byId = new Map(all.map((b) => [b.id, b]));
      const ordered = [...ids.filter((id) => byId.has(id)), ...all.filter((b) => !ids.includes(b.id)).map((b) => b.id)];
      this.store.setBanners(ordered.map((id, i) => ({ ...(byId.get(id) as ContentBanner), order: i + 1 })));
      this.state.record('content.banner.reorder', 'Home banners', 'Changed the order');
      return this.store.banners();
    });
  }

  // ---- home sections ----
  sections() {
    return this.respond.okAsync<HomeSection[]>(async () => {
      this.guard();
      return this.store.sections();
    });
  }

  saveSections(sections: HomeSection[]) {
    return this.respond.okAsync<HomeSection[]>(async () => {
      this.guard();
      const keys = sections.map((s) => s.key);
      if (keys.length !== SECTION_KEYS.length || SECTION_KEYS.some((k) => !keys.includes(k))) throw new ApiException('validation', 'Every home section must be present exactly once.');
      const f: Record<string, string> = {};
      sections.forEach((s, i) => {
        if (!s.title.trim() || s.title.length > 40) f[`sections.${i}.title`] = 'Title is required (40 characters at most)';
      });
      if (Object.keys(f).length) fail(f);
      this.store.setSections(sections.map((s, i) => ({ ...s, title: s.title.trim(), order: i + 1 })));
      this.state.record('content.sections', 'Home sections', `${sections.filter((s) => s.enabled).length} of ${sections.length} enabled`);
      return this.store.sections();
    });
  }

  // ---- pages ----
  pages() {
    return this.respond.okAsync<ManagedPage[]>(async () => {
      this.guard();
      return this.store.pages();
    });
  }

  savePage(input: PageInput, isNew: boolean) {
    return this.respond.okAsync<ManagedPage>(async () => {
      this.guard();
      const slug = input.slug.trim();
      const f: Record<string, string> = {};
      if (!SLUG.test(slug) || slug.length > 60) f['slug'] = 'Use lowercase letters, numbers and hyphens (60 characters at most)';
      else if (RESERVED_SLUGS.has(slug)) f['slug'] = 'This address is reserved';
      if (!input.title.trim()) f['title'] = 'Title is required';
      if (input.source.length > 10000) f['source'] = 'The text is too long (10,000 characters at most)';
      if ((input.seoDescription ?? '').length > 160) f['seoDescription'] = 'Keep the description under 160 characters';
      const existing = this.store.pages().find((p) => p.slug === slug);
      if (isNew && existing) f['slug'] = 'A page with this address already exists';
      if (!isNew && !existing) throw new ApiException('not_found', 'Page not found');
      if (Object.keys(f).length) fail(f);

      const page: ManagedPage = {
        slug,
        title: input.title.trim(),
        source: input.source,
        body: renderContent(input.source),
        status: input.status,
        ...(input.seoTitle?.trim() ? { seoTitle: input.seoTitle.trim() } : {}),
        ...(input.seoDescription?.trim() ? { seoDescription: input.seoDescription.trim() } : {}),
        updatedAt: nowIso(),
        locked: existing?.locked ?? false,
      };
      this.store.savePage(page);
      this.state.record(isNew ? 'content.page.create' : 'content.page.update', page.title, page.status);
      return page;
    });
  }

  deletePage(slug: string) {
    return this.respond.okAsync<ManagedPage[]>(async () => {
      this.guard();
      const page = this.store.pages().find((p) => p.slug === slug);
      if (!page) throw new ApiException('not_found', 'Page not found');
      if (page.locked) throw new ApiException('validation', 'Legal pages cannot be deleted, only edited.');
      this.store.deletePage(slug);
      this.state.record('content.page.delete', page.title, 'Deleted');
      return this.store.pages();
    });
  }

  // ---- links ----
  links() {
    return this.respond.okAsync<NavLink[]>(async () => {
      this.guard();
      return this.store.links();
    });
  }

  saveLinks(links: Omit<NavLink, 'id' | 'order'>[]) {
    return this.respond.okAsync<NavLink[]>(async () => {
      this.guard();
      const f: Record<string, string> = {};
      const perGroup = new Map<string, number>();
      links.forEach((l, i) => {
        if (!l.label.trim() || l.label.length > 40) f[`links.${i}.label`] = 'Label is required (40 characters at most)';
        if (!validLink(l.href)) f[`links.${i}.href`] = 'Use an internal path such as /pages/faq or an https:// address';
        perGroup.set(l.group, (perGroup.get(l.group) ?? 0) + 1);
        if ((perGroup.get(l.group) ?? 0) > MAX_LINKS_PER_GROUP) f[`links.${i}.label`] = `A group can hold ${MAX_LINKS_PER_GROUP} links at most`;
      });
      if (Object.keys(f).length) fail(f);
      const counters = new Map<string, number>();
      this.store.setLinks(links.map((l, i) => ({ id: `lnk-${Date.now().toString(36)}${i}`, label: l.label.trim(), href: l.href, group: l.group, order: (counters.set(l.group, (counters.get(l.group) ?? 0) + 1), counters.get(l.group) as number) })));
      this.state.record('content.links', 'Footer links', `${links.length} links saved`);
      return this.store.links();
    });
  }

  // ---- redirects ----
  redirects() {
    return this.respond.okAsync<Redirect[]>(async () => {
      this.guard();
      return this.store.redirects();
    });
  }

  addRedirect(from: string, to: string) {
    return this.respond.okAsync<Redirect[]>(async () => {
      this.guard();
      const f: Record<string, string> = {};
      const source = from.trim();
      const target = to.trim();
      if (!/^\/[^\s?#]*$/.test(source) || source === '/') f['from'] = 'Use a path starting with / (not the home page, no query string)';
      if (!validLink(target)) f['to'] = 'Use an internal path or an https:// address';
      const existing = this.store.redirects();
      if (existing.some((r) => r.from === normalisePath(source))) f['from'] = 'This path already redirects somewhere';
      if (normalisePath(source) === normalisePath(target)) f['to'] = 'A redirect cannot point to itself';
      if (Object.keys(f).length) fail(f);
      // Loop detection: follow the chain from the new target; reaching `source` again would loop forever.
      const map = new Map(existing.map((r) => [r.from, r.to]));
      map.set(normalisePath(source), target);
      let cursor = normalisePath(target);
      for (let hop = 0; hop < 20 && map.has(cursor); hop++) {
        cursor = normalisePath(map.get(cursor) as string);
        if (cursor === normalisePath(source)) throw new ApiException('validation', 'This redirect would create a loop.', { to: 'Creates a redirect loop' });
      }
      this.store.setRedirects([...existing, { id: `rd-${Date.now().toString(36)}`, from: normalisePath(source), to: target, createdAt: nowIso() }]);
      this.state.record('content.redirect.add', normalisePath(source), `to ${target}`);
      return this.store.redirects();
    });
  }

  removeRedirect(id: string) {
    return this.respond.okAsync<Redirect[]>(async () => {
      this.guard();
      const found = this.store.redirects().find((r) => r.id === id);
      if (!found) throw new ApiException('not_found', 'Redirect not found');
      this.store.setRedirects(this.store.redirects().filter((r) => r.id !== id));
      this.state.record('content.redirect.remove', found.from, 'Removed');
      return this.store.redirects();
    });
  }
}
