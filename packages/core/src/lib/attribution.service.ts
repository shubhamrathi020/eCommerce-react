import { Injectable, inject } from '../runtime';
import { type Touch, cleanTag } from '@ecom/contracts';
import { ConsentService } from './consent.service';
import { PersonalisationService } from './personalisation.service';
import { STORAGE } from './tokens';

const KEY = 'ecom.attribution.v1';
const WINDOW_MS = 30 * 86_400_000;

interface Stored {
  first?: Touch & { at: string };
  last?: Touch & { at: string };
}

/**
 * Remembers where a shopper came from (BRD 16, AN-05): the first and the last campaign seen in `utm_*` URL parameters.
 * Recorded only after the shopper accepts analytics and never while opted out; values are reduced to short lowercase tags, so
 * a crafted link cannot smuggle markup or personal data into a report. Touches older than 30 days are dropped.
 */
@Injectable({ providedIn: 'root' })
export class AttributionService {
  private readonly storage = inject(STORAGE);
  private readonly consent = inject(ConsentService);
  private readonly personalisation = inject(PersonalisationService);

  /** Call on every navigation with the URL's query parameters. */
  capture(params: Record<string, string | string[] | undefined>): void {
    if (!this.consent.analyticsAllowed() || this.personalisation.optedOut()) return;
    const pick = (name: string) => cleanTag(Array.isArray(params[name]) ? (params[name] as string[])[0] : (params[name] as string | undefined));
    const source = pick('utm_source');
    if (!source) return;
    const medium = pick('utm_medium');
    const campaign = pick('utm_campaign');
    const touch = { source, ...(medium ? { medium } : {}), ...(campaign ? { campaign } : {}), at: new Date().toISOString() };
    const stored = this.read();
    this.write({ first: stored.first ?? touch, last: touch });
  }

  /** The first and last touch still inside the 30-day window. */
  touches(): { first?: Touch; last?: Touch } {
    const stored = this.read();
    const strip = (t?: Stored['first']): Touch | undefined => (t ? { source: t.source, ...(t.medium ? { medium: t.medium } : {}), ...(t.campaign ? { campaign: t.campaign } : {}) } : undefined);
    const first = strip(stored.first);
    const last = strip(stored.last);
    return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
  }

  clear(): void {
    try {
      this.storage.removeItem(KEY);
    } catch {
      // Storage blocked.
    }
  }

  private read(): Stored {
    try {
      const raw = this.storage.getItem(KEY);
      const stored = raw ? (JSON.parse(raw) as Stored) : {};
      const fresh = (t?: Stored['first']) => (t && Date.now() - new Date(t.at).getTime() <= WINDOW_MS ? t : undefined);
      const first = fresh(stored.first);
      const last = fresh(stored.last);
      return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
    } catch {
      return {};
    }
  }

  private write(stored: Stored): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(stored));
    } catch {
      // Storage blocked: attribution is best effort.
    }
  }
}
