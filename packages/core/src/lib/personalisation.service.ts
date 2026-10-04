import { Injectable, inject, signal } from '../runtime';
import { STORAGE } from './tokens';

const OPT_OUT_KEY = 'ecom.rec.optout.v1';
const VISITOR_KEY = 'ecom.rec.vid.v1';

const randomId = () => `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The shopper's personalisation choices (BRD 15, RC-06). The anonymous visitor id and the opt-out flag live only in this
 * browser. Opting out stops event tracking and personalised rows; resetting the visitor id detaches this browser from
 * every event recorded under the old one.
 */
@Injectable({ providedIn: 'root' })
export class PersonalisationService {
  private readonly storage = inject(STORAGE);
  private readonly _optedOut = signal(this.read(OPT_OUT_KEY) === '1');
  readonly optedOut = this._optedOut.asReadonly();

  setOptOut(value: boolean): void {
    this._optedOut.set(value);
    this.write(OPT_OUT_KEY, value ? '1' : '0');
  }

  /** This browser's anonymous id, created on first use. Contains no personal data. */
  visitorId(): string {
    const existing = this.read(VISITOR_KEY);
    if (existing) return existing;
    return this.resetVisitor();
  }

  /** Starts a new anonymous identity (used when history is cleared). */
  resetVisitor(): string {
    const id = randomId();
    this.write(VISITOR_KEY, id);
    return id;
  }

  private read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
  }
}
