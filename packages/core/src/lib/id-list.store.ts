import { computed, inject, signal } from '../runtime';
import { STORAGE } from './tokens';

/** Signal-backed list of ids persisted to storage. Base for recently viewed, compare and wishlist. */
export abstract class IdListStore {
  private readonly storage = inject(STORAGE);
  protected abstract readonly storageKey: string;
  protected abstract readonly maxItems: number;

  private readonly _ids = signal<string[]>([]);

  readonly ids = this._ids.asReadonly();
  readonly count = computed(() => this._ids().length);

  has(id: string): boolean {
    return this.ids().includes(id);
  }

  protected write(next: string[]): void {
    this._ids.set(next);
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // Storage may be full or blocked; the in-memory list still works.
    }
  }

  protected current(): string[] {
    return this._ids();
  }

  /** Subclasses call this from their constructor, once `storageKey` and `maxItems` are set. */
  protected load(): void {
    try {
      const raw = this.storage.getItem(this.storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this._ids.set(parsed.filter((v): v is string => typeof v === 'string').slice(0, this.maxItems));
    } catch {
      this._ids.set([]);
    }
  }
}
