import type { Observable } from 'rxjs';
import type { ContentBanner, HomeConfig, HomeSection, ManagedPage, NavLink, PageStatus, Redirect } from '@ecom/contracts';

/** What shoppers read. Only published, in-date content is ever returned. */
export abstract class ContentApi {
  abstract homeConfig(): Observable<HomeConfig>;
  abstract navigation(): Observable<NavLink[]>;
  /** The path to redirect to (permanently), or null. */
  abstract redirectFor(path: string): Observable<string | null>;
}

export interface PageInput {
  slug: string;
  title: string;
  source: string;
  status: PageStatus;
  seoTitle?: string;
  seoDescription?: string;
}

export type BannerInput = Omit<ContentBanner, 'id' | 'order'> & { id?: string };

/**
 * Staff-facing content management. Every call needs `content:write` and every change is audited.
 * Errors are `ApiException`s (`forbidden`, `validation`, `not_found`).
 */
export abstract class AdminContentApi {
  abstract banners(): Observable<ContentBanner[]>;
  abstract saveBanner(input: BannerInput): Observable<ContentBanner[]>;
  abstract deleteBanner(id: string): Observable<ContentBanner[]>;
  /** Sets the display order to match `ids`. */
  abstract reorderBanners(ids: string[]): Observable<ContentBanner[]>;

  abstract sections(): Observable<HomeSection[]>;
  abstract saveSections(sections: HomeSection[]): Observable<HomeSection[]>;

  abstract pages(): Observable<ManagedPage[]>;
  abstract savePage(input: PageInput, isNew: boolean): Observable<ManagedPage>;
  abstract deletePage(slug: string): Observable<ManagedPage[]>;

  abstract links(): Observable<NavLink[]>;
  /** Replaces all links; order follows the array order within each group. */
  abstract saveLinks(links: Omit<NavLink, 'id' | 'order'>[]): Observable<NavLink[]>;

  abstract redirects(): Observable<Redirect[]>;
  abstract addRedirect(from: string, to: string): Observable<Redirect[]>;
  abstract removeRedirect(id: string): Observable<Redirect[]>;
}
