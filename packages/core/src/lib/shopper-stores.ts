import { Injectable } from '../runtime';
import { IdListStore } from './id-list.store';

/** Last products the shopper looked at, newest first. */
@Injectable({ providedIn: 'root' })
export class RecentlyViewedStore extends IdListStore {
  protected readonly storageKey = 'ecom.recent.v1';
  protected readonly maxItems = 12;

  constructor() {
    super();
    this.load();
  }

  add(id: string): void {
    this.write([id, ...this.current().filter((x) => x !== id)].slice(0, this.maxItems));
  }
}

/** Up to four products chosen for side-by-side comparison. */
@Injectable({ providedIn: 'root' })
export class CompareStore extends IdListStore {
  protected readonly storageKey = 'ecom.compare.v1';
  protected readonly maxItems = 4;
  readonly limit = 4;

  constructor() {
    super();
    this.load();
  }

  /** Returns false when the list is already full. */
  add(id: string): boolean {
    const list = this.current();
    if (list.includes(id)) return true;
    if (list.length >= this.maxItems) return false;
    this.write([...list, id]);
    return true;
  }

  remove(id: string): void {
    this.write(this.current().filter((x) => x !== id));
  }

  clear(): void {
    this.write([]);
  }
}

/** Wishlist ids (device-local for now; server-backed with the accounts module). */
@Injectable({ providedIn: 'root' })
export class WishlistStore extends IdListStore {
  protected readonly storageKey = 'ecom.wishlist.v1';
  protected readonly maxItems = 200;

  constructor() {
    super();
    this.load();
  }

  toggle(id: string): boolean {
    const list = this.current();
    const added = !list.includes(id);
    this.write(added ? [id, ...list] : list.filter((x) => x !== id));
    return added;
  }
}

/** The shopper's last search terms on this device (never sent anywhere). */
@Injectable({ providedIn: 'root' })
export class RecentSearchesStore extends IdListStore {
  protected readonly storageKey = 'ecom.recent-searches.v1';
  protected readonly maxItems = 8;

  constructor() {
    super();
    this.load();
  }

  add(term: string): void {
    const t = term.trim().slice(0, 100);
    if (!t) return;
    this.write([t, ...this.current().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, this.maxItems));
  }

  remove(term: string): void {
    this.write(this.current().filter((x) => x !== term));
  }

  clear(): void {
    this.write([]);
  }
}
