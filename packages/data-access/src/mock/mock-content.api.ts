import { Injectable, inject } from '@shop/core';
import type { CmsPage, HomeConfig } from '@ecom/contracts';
import { CmsApi } from '../lib/cms.api';
import { ContentApi } from '../lib/content.api';
import { MockContentStore } from './content-store';
import { createMockResponder } from './mock-latency';
import { MockUserStore } from './mock-user-store';

const MAX_HOPS = 5;

/** Strips query, fragment and a trailing slash so `/old/?a=1` matches a redirect from `/old`. */
export function normalisePath(path: string): string {
  const clean = path.split('#')[0].split('?')[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

@Injectable()
export class MockContentApi extends ContentApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockContentStore);

  homeConfig() {
    return this.respond.ok<HomeConfig>(() => {
      const now = Date.now();
      const banners = this.store
        .banners()
        .filter((b) => b.active && (!b.startsAt || new Date(b.startsAt).getTime() <= now) && (!b.endsAt || new Date(b.endsAt).getTime() >= now))
        .map(({ id, title, subtitle, cta, link, image }) => ({ id, title, subtitle, cta, link, image }));
      return { banners, sections: this.store.sections().filter((s) => s.enabled) };
    });
  }

  navigation() {
    return this.respond.ok(() => this.store.links());
  }

  redirectFor(path: string) {
    return this.respond.ok<string | null>(() => {
      const map = new Map(this.store.redirects().map((r) => [r.from, r.to]));
      let current = normalisePath(path);
      let target: string | null = null;
      for (let hop = 0; hop < MAX_HOPS && map.has(current); hop++) {
        target = map.get(current) as string;
        current = normalisePath(target);
      }
      return target;
    });
  }
}

@Injectable()
export class MockCmsApi extends CmsApi {
  private readonly respond = createMockResponder();
  private readonly store = inject(MockContentStore);
  private readonly users = inject(MockUserStore);

  page(slug: string, options?: { preview?: boolean }) {
    const page = this.store.pages().find((p) => p.slug === slug);
    const isStaff = !!this.users.session()?.user.permissions.includes('content:write');
    const visible = !!page && (page.status === 'published' || (!!options?.preview && isStaff));
    if (!page || !visible) return this.respond.fail<CmsPage>({ code: 'not_found', message: 'Page not found' });
    const result: CmsPage = {
      slug: page.slug,
      title: page.title,
      body: page.body,
      ...(page.seoTitle || page.seoDescription ? { seo: { ...(page.seoTitle ? { title: page.seoTitle } : {}), ...(page.seoDescription ? { description: page.seoDescription } : {}) } } : {}),
      ...(page.status === 'draft' ? { preview: true } : {}),
    };
    return this.respond.ok(() => result);
  }
}
