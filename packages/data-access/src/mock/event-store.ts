import { Injectable, inject } from '@shop/core';
import { STORAGE } from '@shop/core';
import type { SinkEvent } from '@shop/core';
import type { Product, TrackedEvent } from '@ecom/contracts';

const KEY = 'ecom.mock.events.v1';
const MAX_EVENTS = 5000;
const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Searches shoppers make that find nothing (BRD 16 reads these too). */
export const SEED_ZERO_RESULT_TERMS = ['wireles earbuds', 'iphone 17 case', 'kurta set', 'yoga mat blue', 'air fryer 10 litre', 'gaming chair', 'ayurvedic shampoo'];
const SEED_TERMS = ['shirt', 'running shoes', 'headphones', 'laptop', 'dumbbell', 'cookware', 'moisturizer', 'books', 'watch', 'backpack'];
/** source | medium | campaign, as written by the attribution service. */
const SEED_TOUCHES = ['google|cpc|festive-sale', 'instagram|social|reels', 'newsletter|email|weekly', 'direct|none|none', 'facebook|social|retarget'];

const cache = new Map<string, TrackedEvent[]>();

/**
 * Deterministic demo behaviour for the last 30 days, so trending, best sellers and "bought together" have numbers on day one
 * and cold-start behaviour is visible. Marked `seed: true`. It is derived from the catalog's own popularity and recomputed per
 * day, never stored. Purchases form baskets (grouped by `orderId`) with a few repeating pairings so co-purchase counts add up.
 */
export function seedEvents(products: Product[], now: number): TrackedEvent[] {
  const dayKey = `${Math.floor(now / DAY)}:${products.length}`;
  const hit = cache.get(dayKey);
  if (hit) return hit;
  const rnd = mulberry32(15);
  const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
  const weights = products.map((p) => Math.pow(p.popularity + 1, 1.4));
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = (): number => {
    let r = rnd() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };
  /** The same product tends to be bought with the same companions: its neighbours in catalog order within its department. */
  const companions = (i: number): number[] => {
    const root = products[i].categoryPath[0]?.id;
    const same = products.map((p, idx) => ({ p, idx })).filter((x) => x.p.categoryPath[0]?.id === root);
    const at = same.findIndex((x) => x.idx === i);
    return [same[(at + 1) % same.length].idx, same[(at + 5) % same.length].idx, same[(at + 11) % same.length].idx].filter((x) => x !== i);
  };

  const events: TrackedEvent[] = [];
  let n = 0;
  const push = (at: number, vid: string, name: string, props: TrackedEvent['props']) => {
    events.push({ id: `evt_seed_${n++}`, at: new Date(at).toISOString(), vid, name, ...(props ? { props } : {}), seed: true });
  };
  const ref = (p: Product) => ({ productId: p.id, categoryId: p.categoryId });

  for (let s = 0; s < 800; s++) {
    const vid = `v_seed_${int(1, 160)}`;
    const base = now - rnd() * rnd() * 30 * DAY - int(0, 600) * 60_000;
    let t = base;
    const viewed = Array.from({ length: int(1, 3) }, () => pick());
    for (const i of viewed) {
      push((t += int(1, 4) * 60_000), vid, 'product_view', ref(products[i]));
    }
    const firstTouch = SEED_TOUCHES[int(0, SEED_TOUCHES.length - 1)];
    const lastTouch = rnd() < 0.6 ? firstTouch : SEED_TOUCHES[int(0, SEED_TOUCHES.length - 1)];
    if (rnd() < 0.3) {
      const i = viewed[0];
      push((t += 60_000), vid, 'add_to_cart', { ...ref(products[i]), quantity: 1 });
      if (rnd() < 0.6) {
        push((t += 90_000), vid, 'checkout_start', { last_touch: lastTouch });
        if (rnd() < 0.85) {
          push((t += 60_000), vid, 'payment_start', { last_touch: lastTouch });
          if (rnd() < 0.8) {
            const orderId = `SEEDORD-${s}`;
            const basket = [i, ...(rnd() < 0.55 ? companions(i) : [])];
            for (const idx of basket) push((t += 5_000), vid, 'purchase', { ...ref(products[idx]), quantity: int(1, 2), orderId, unitPrice: Math.min(...products[idx].variants.map((v) => v.price.amount)), first_touch: firstTouch, last_touch: lastTouch });
          }
        }
      }
    }
    if (rnd() < 0.25) {
      const zero = rnd() < 0.3;
      const term = zero ? SEED_ZERO_RESULT_TERMS[int(0, SEED_ZERO_RESULT_TERMS.length - 1)] : SEED_TERMS[int(0, SEED_TERMS.length - 1)];
      push(base - 120_000, vid, zero ? 'search_zero_results' : 'search', { term, results: zero ? 0 : int(3, 80) });
      if (!zero && rnd() < 0.6) push(base - 60_000, vid, 'search_result_click', { term, productId: products[pick()].id });
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  cache.clear();
  cache.set(dayKey, events);
  return events;
}

/** Device-local store of the events this browser has recorded (mock only; a real backend keeps these server-side). */
@Injectable({ providedIn: 'root' })
export class MockEventStore {
  private readonly storage = inject(STORAGE);

  /** Real events only. */
  recorded(): TrackedEvent[] {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? (JSON.parse(raw) as TrackedEvent[]) : [];
    } catch {
      return [];
    }
  }

  /** Demo plus recorded events, oldest first. */
  all(products: Product[], now = Date.now()): TrackedEvent[] {
    return [...seedEvents(products, now), ...this.recorded()];
  }

  add(event: SinkEvent): void {
    const stored: TrackedEvent = { id: `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: event.at, vid: event.vid, name: event.name, ...(event.props ? { props: event.props } : {}) };
    this.write([...this.recorded(), stored].slice(-MAX_EVENTS));
  }

  /** Deletes everything recorded for one visitor id (RC-06). Returns how many were removed. */
  clearVisitor(vid: string): number {
    const all = this.recorded();
    const kept = all.filter((e) => e.vid !== vid);
    this.write(kept);
    return all.length - kept.length;
  }

  countFor(vid: string): number {
    return this.recorded().filter((e) => e.vid === vid).length;
  }

  private write(events: TrackedEvent[]): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(events));
    } catch {
      // Storage full or blocked.
    }
  }
}
