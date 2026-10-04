import { Injectable, inject } from '../runtime';
import { APP_CONFIG } from './tokens';

export interface SeoData {
  title: string;
  description?: string;
  /** Path such as `/p/blue-shirt`; combined with siteUrl. */
  path?: string;
  image?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
}

/** Sets the document title, meta tags, canonical link and JSON-LD for the page being shown. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly config = inject(APP_CONFIG);

  set(data: SeoData): void {
    if (typeof document === 'undefined') return;
    const fullTitle = `${data.title} | ${this.config.siteName}`;
    document.title = fullTitle;
    this.setMeta('name', 'description', data.description);
    this.setMeta('name', 'robots', data.noindex ? 'noindex,follow' : 'index,follow');
    this.setMeta('property', 'og:title', fullTitle);
    this.setMeta('property', 'og:description', data.description);
    this.setMeta('property', 'og:type', 'website');
    this.setMeta('property', 'og:site_name', this.config.siteName);
    this.setMeta('property', 'og:image', data.image);
    this.setCanonical(data.path);
    this.setJsonLd(data.jsonLd);
  }

  private setMeta(attr: 'name' | 'property', key: string, content?: string): void {
    const selector = `meta[${attr}="${key}"]`;
    const existing = document.head.querySelector<HTMLMetaElement>(selector);
    if (!content) {
      existing?.remove();
      return;
    }
    const tag = existing ?? document.head.appendChild(document.createElement('meta'));
    tag.setAttribute(attr, key);
    tag.setAttribute('content', content);
  }

  private setCanonical(path?: string): void {
    const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (path === undefined) {
      existing?.remove();
      return;
    }
    const link = existing ?? document.head.appendChild(document.createElement('link'));
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', new URL(path, this.config.siteUrl).toString());
  }

  private setJsonLd(data?: Record<string, unknown>): void {
    const id = 'seo-jsonld';
    document.getElementById(id)?.remove();
    if (!data) return;
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    // Escape "<" so data can never close the script element.
    script.text = JSON.stringify(data).replace(/</g, '\\u003c');
    document.head.appendChild(script);
  }
}
