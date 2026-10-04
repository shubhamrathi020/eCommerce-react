import { Injectable, computed, inject, signal } from '../runtime';
import { STORAGE } from './tokens';

export type ConsentChoice = 'all' | 'essential';

const KEY = 'ecom.consent.v1';

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly storage = inject(STORAGE);
  private readonly _choice = signal<ConsentChoice | null>(this.read());

  readonly choice = this._choice.asReadonly();
  readonly needsDecision = computed(() => this._choice() === null);
  readonly analyticsAllowed = computed(() => this._choice() === 'all');

  set(choice: ConsentChoice): void {
    this._choice.set(choice);
    this.storage.setItem(KEY, choice);
  }

  private read(): ConsentChoice | null {
    const value = this.storage.getItem(KEY);
    return value === 'all' || value === 'essential' ? value : null;
  }
}
