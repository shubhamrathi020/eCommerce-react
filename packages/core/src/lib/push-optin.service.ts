import { Injectable, inject, signal } from '../runtime';
import { STORAGE } from './tokens';

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

const KEY = 'ecom.push.optin.v1';

/**
 * Order-update notifications on this device. Explicit and revocable: nothing is requested until the shopper presses the
 * button, and turning it off forgets the opt-in. Without a push server the only thing that can arrive is a test
 * notification shown by this browser, and the page says so. The browser's own permission can only be changed in its settings.
 */
@Injectable({ providedIn: 'root' })
export class PushOptInService {
  private readonly storage = inject(STORAGE);
  private readonly _state = signal<PushState>('off');
  readonly state = this._state.asReadonly();

  constructor() {
    this.refresh();
  }

  /** Re-reads the browser permission and the saved opt-in. */
  refresh(): void {
    if (typeof Notification === 'undefined') {
      this._state.set(typeof window === 'undefined' ? 'off' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') this._state.set('blocked');
    else this._state.set(Notification.permission === 'granted' && this.storage.getItem(KEY) === '1' ? 'on' : 'off');
  }

  async enable(): Promise<PushState> {
    if (typeof Notification === 'undefined') {
      this._state.set('unsupported');
      return 'unsupported';
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission === 'granted') {
      this.storage.setItem(KEY, '1');
      this._state.set('on');
    } else {
      this.storage.removeItem(KEY);
      this._state.set(permission === 'denied' ? 'blocked' : 'off');
    }
    return this._state();
  }

  disable(): void {
    this.storage.removeItem(KEY);
    this.refresh();
  }

  /** Shows a notification through the service worker when there is one (as a real push would), else directly. */
  async sendTest(title: string, body: string): Promise<boolean> {
    if (this._state() !== 'on' || typeof Notification === 'undefined') return false;
    const options = { body, icon: '/icons/icon-192.png', tag: 'order-update-test' };
    try {
      const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (registration) await registration.showNotification(title, options);
      else new Notification(title, options);
      return true;
    } catch {
      return false;
    }
  }
}
