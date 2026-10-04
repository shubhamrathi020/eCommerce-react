import { Injectable, InjectionToken, inject } from '../runtime';
import { touchKey } from '@ecom/contracts';
import { AttributionService } from './attribution.service';
import { ConsentService } from './consent.service';
import { PersonalisationService } from './personalisation.service';

export interface AnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
}

/** An event as it reaches the sink: the anonymous visitor id and a time are added here, nothing personal. */
export interface SinkEvent extends AnalyticsEvent {
  vid: string;
  at: string;
}

const ATTRIBUTED = new Set(['checkout_start', 'payment_start', 'purchase']);

/** Where tracked events go. The mock data-access layer provides one that stores them on the device; none means a no-op. */
export const EVENT_SINK = new InjectionToken<(event: SinkEvent) => void>('EVENT_SINK');

/**
 * Behaviour tracking (BRD 15, RC-01). Nothing is recorded until the shopper has accepted analytics, and never while they
 * have opted out of personalisation. Payloads must never contain personal data.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly consent = inject(ConsentService);
  private readonly personalisation = inject(PersonalisationService);
  private readonly attribution = inject(AttributionService);
  private readonly sink = inject(EVENT_SINK, { optional: true });

  track(event: AnalyticsEvent): void {
    if (!this.consent.analyticsAllowed() || this.personalisation.optedOut()) return;
    // Funnel events carry the campaign that brought the shopper (BRD 16): a short tag, never a URL or a person.
    const touches = ATTRIBUTED.has(event.name) ? this.attribution.touches() : {};
    const props = { ...event.props, ...(touches.first && event.name === 'purchase' ? { first_touch: touchKey(touches.first) } : {}), ...(touches.last ? { last_touch: touchKey(touches.last) } : {}) };
    this.sink?.({ ...event, ...(Object.keys(props).length ? { props } : {}), vid: this.personalisation.visitorId(), at: new Date().toISOString() });
  }
}
