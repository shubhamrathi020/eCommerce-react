import { Injectable, computed, inject, signal } from '../runtime';
import { STORAGE } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'ecom.theme.v1';

/**
 * Light, dark, or follow the device. The choice is kept in this browser. `data-theme` on <html> is set only for an
 * explicit light or dark; with "system" the attribute is absent and the stylesheet follows `prefers-color-scheme`. A tiny
 * script in each app's index.html applies the saved choice before first paint, so a dark-mode visitor never sees a flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(STORAGE);

  private readonly _preference = signal<ThemePreference>(this.read());
  private readonly systemDark = signal(typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false);

  readonly preference = this._preference.asReadonly();
  /** What the page actually looks like right now. */
  readonly effective = computed<'light' | 'dark'>(() => (this._preference() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this._preference() as 'light' | 'dark')));

  constructor() {
    if (typeof document === 'undefined') return;
    this.apply(this._preference());
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
  }

  set(preference: ThemePreference): void {
    this._preference.set(preference);
    try {
      this.storage.setItem(KEY, preference);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
    this.apply(preference);
  }

  private apply(preference: ThemePreference): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
  }

  private read(): ThemePreference {
    try {
      const value = this.storage.getItem(KEY);
      return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
    } catch {
      return 'system';
    }
  }
}
