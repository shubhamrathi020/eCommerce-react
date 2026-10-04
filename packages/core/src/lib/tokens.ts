import type { AppConfig } from '@ecom/contracts';
import { InjectionToken } from '../runtime';

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

/** Minimal storage contract. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Storage that is tolerant of blocked or full browser storage (private windows, tests without a DOM). */
export const STORAGE = new InjectionToken<KeyValueStorage>('STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      const probe = '__ecom_probe__';
      localStorage.setItem(probe, probe);
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return new MemoryStorage();
    }
  },
});
