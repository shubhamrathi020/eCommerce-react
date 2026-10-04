import { Injectable, signal } from '../runtime';

/** Tracks whether the browser currently has a network connection, for an offline banner. */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly _online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this._online.asReadonly();

  /** True when the page on screen came from the service worker's saved copy, so prices and stock may be old. Stays true until the page is reloaded. */
  private readonly _savedCopy = signal(false);
  readonly savedCopy = this._savedCopy.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this._online.set(true));
    window.addEventListener('offline', () => this._online.set(false));
    // A page the service worker answered from its saved copies carries a marker tag (see the app's public/sw.js).
    if (document.querySelector('meta[name="sw-saved-copy"]')) this._savedCopy.set(true);
  }
}
