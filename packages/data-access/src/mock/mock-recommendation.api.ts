import { Injectable, inject } from '@shop/core';
import { PersonalisationService, STORAGE } from '@shop/core';
import type { Product, RecConfig, RecItem, RecPreview, RecRow, RecStats } from '@ecom/contracts';
import {
  ApiException,
  DEFAULT_REC_CONFIG,
  MIN_PROFILE_WEIGHT,
  MIN_ROW_ITEMS,
  MIN_TOGETHER_ITEMS,
  activityByProduct,
  applyRules,
  coPurchases,
  eventStats,
  interestProfile,
  profileScore,
  similarity,
  stockStatusOf,
  toSummary,
} from '@ecom/contracts';
import { AdminRecommendationApi, RecommendationApi } from '../lib/recommendation.api';
import { loadCatalogData } from './catalog-data';
import { MockEventStore } from './event-store';
import { MockInventoryStore } from './inventory-store';
import { createMockResponder } from './mock-latency';
import { MockAdminState } from './admin/admin-state';

const CONFIG_KEY = 'ecom.mock.rec-config.v1';

/** Admin recommendation rules, stored on this device. */
@Injectable({ providedIn: 'root' })
export class MockRecConfigStore {
  private readonly storage = inject(STORAGE);

  read(): RecConfig {
    try {
      const raw = this.storage.getItem(CONFIG_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<RecConfig>) : {};
      return { ...DEFAULT_REC_CONFIG, ...saved, strategies: { ...DEFAULT_REC_CONFIG.strategies, ...saved.strategies } };
    } catch {
      return { ...DEFAULT_REC_CONFIG };
    }
  }

  write(config: RecConfig): void {
    try {
      this.storage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Storage full or blocked.
    }
  }
}

const rowOf = (strategy: RecRow['strategy'], title: string, subtitle: string, items: RecItem[], coldStart = false, min = MIN_ROW_ITEMS): RecRow | null =>
  items.length >= min ? { strategy, title, subtitle, items, ...(coldStart ? { coldStart: true } : {}) } : null;

/** Builds every row from events, the catalog and the admin rules. Shared by the shop and the admin preview. */
@Injectable({ providedIn: 'root' })
export class RecommendationEngine {
  private readonly events = inject(MockEventStore);
  private readonly config = inject(MockRecConfigStore);
  private readonly inventory = inject(MockInventoryStore);
  private readonly personalisation = inject(PersonalisationService);

  private async context(now = Date.now()) {
    const { products } = await loadCatalogData();
    // Live stock: out-of-stock products are never recommended.
    const stocked = this.inventory.apply(products);
    const byId = new Map(stocked.map((p) => [p.id, p]));
    return { products: stocked, byId, events: this.events.all(products, now), config: this.config.read(), now };
  }

  private items(ids: string[], byId: Map<string, Product>, reason: (id: string) => string): RecItem[] {
    return ids.flatMap((id) => {
      const p = byId.get(id);
      return p && stockStatusOf(p).status !== 'out_of_stock' ? [{ product: toSummary(p), reason: reason(id) }] : [];
    });
  }

  async forProduct(productId: string): Promise<{ similar: RecRow | null; together: RecRow | null }> {
    const { products, byId, events, config } = await this.context();
    const current = byId.get(productId);
    if (!current) return { similar: null, together: null };

    let similar: RecRow | null = null;
    if (config.strategies.similar) {
      const scored = new Map<string, { score: number; reason: string }>();
      for (const p of products) {
        const s = similarity(current, p);
        if (s.score >= 3) scored.set(p.id, s);
      }
      const ids = applyRules(
        [...scored].map(([id, s]) => ({ id, score: s.score })),
        config,
        (id) => byId.get(id)?.categoryPath[0]?.id === current.categoryPath[0]?.id,
      ).filter((id) => id !== productId);
      similar = rowOf('similar', 'Similar products', 'Chosen for the same category, brand, tags and price range', this.items(ids, byId, (id) => scored.get(id)?.reason ?? 'Recommended by the team'));
    }

    let together: RecRow | null = null;
    if (config.strategies.bought_together) {
      const counts = coPurchases(events, productId);
      const ids = applyRules(
        [...counts].filter(([, n]) => n >= config.minTogether).map(([id, n]) => ({ id, score: n })),
        config,
        () => false,
      ).filter((id) => id !== productId);
      together = rowOf('bought_together', 'Frequently bought together', `Bought in the same order by ${config.minTogether}+ shoppers`, this.items(ids, byId, (id) => `Bought together in ${counts.get(id) ?? 0} orders`), false, MIN_TOGETHER_ITEMS);
    }
    return { similar, together };
  }

  /** `vid` is the visitor to personalise for; `undefined` previews a brand-new visitor. */
  async home(vid: string | undefined, optedOut: boolean): Promise<{ personalised: RecRow | null; trending: RecRow | null; bestSellers: RecRow | null }> {
    const { byId, events, config, now } = await this.context();
    const any = () => true;

    const week = activityByProduct(events, now, 7);
    const trendingIds = applyRules([...week].map(([id, a]) => ({ id, score: a.score })), config, any);
    const trendingReason = (id: string) => {
      const a = week.get(id);
      return a ? `${a.views} views and ${a.adds} adds this week` : 'Pinned by the team';
    };
    const trending = config.strategies.trending ? rowOf('trending', 'Trending this week', 'Ranked by recent views, carts and purchases', this.items(trendingIds, byId, trendingReason)) : null;

    const month = activityByProduct(events, now, 30);
    const bestIds = applyRules([...month].filter(([, a]) => a.units > 0).map(([id, a]) => ({ id, score: a.units })), config, any);
    const bestSellers = config.strategies.best_sellers ? rowOf('best_sellers', 'Best sellers', 'Most units sold in the last 30 days', this.items(bestIds, byId, (id) => `${month.get(id)?.units ?? 0} sold this month`)) : null;

    let personalised: RecRow | null = null;
    if (config.strategies.personalised) {
      const profile = !optedOut && vid ? interestProfile(events, vid, byId, now) : undefined;
      if (profile && profile.weight >= MIN_PROFILE_WEIGHT) {
        const popularity = (id: string) => (month.get(id)?.score ?? 0) * 0.001;
        const candidates = [...byId.values()].filter((p) => !profile.bought.has(p.id)).map((p) => ({ id: p.id, score: profileScore(p, profile) + popularity(p.id) })).filter((c) => c.score >= 1);
        const ids = applyRules(candidates, config, any);
        const lastViewed = profile.lastViewed ? byId.get(profile.lastViewed)?.title : undefined;
        personalised = rowOf(
          'personalised',
          'Recommended for you',
          lastViewed ? `Based on what you looked at, like ${lastViewed}` : 'Based on what you looked at recently',
          this.items(ids, byId, (id) => {
            const p = byId.get(id) as Product;
            return `Because you looked at ${p.categoryPath[p.categoryPath.length - 1]?.name ?? 'similar products'}`;
          }),
        );
      }
      // Cold start: a new visitor, an opted-out one, or not enough history yet sees what is popular instead of an empty gap.
      personalised ??= rowOf('personalised', 'Popular right now', optedOut ? 'Personalisation is off, so these are popular with everyone' : 'Popular with shoppers right now', this.items(trendingIds, byId, trendingReason), true);
    }
    return { personalised, trending, bestSellers };
  }

  async stats(): Promise<RecStats> {
    const { events, now } = await this.context();
    return eventStats(events, now);
  }

  currentVisitor(): { vid: string; optedOut: boolean } {
    return { vid: this.personalisation.visitorId(), optedOut: this.personalisation.optedOut() };
  }
}

@Injectable()
export class MockRecommendationApi extends RecommendationApi {
  private readonly respond = createMockResponder();
  private readonly engine = inject(RecommendationEngine);
  private readonly events = inject(MockEventStore);
  private readonly personalisation = inject(PersonalisationService);

  forProduct(productId: string) {
    return this.respond.okAsync(() => this.engine.forProduct(productId));
  }

  home() {
    return this.respond.okAsync(() => {
      const { vid, optedOut } = this.engine.currentVisitor();
      return this.engine.home(vid, optedOut);
    });
  }

  historyCount() {
    return this.respond.ok(() => this.events.countFor(this.personalisation.visitorId()));
  }

  clearHistory() {
    return this.respond.ok(() => {
      this.events.clearVisitor(this.personalisation.visitorId());
      this.personalisation.resetVisitor();
    });
  }
}

@Injectable()
export class MockAdminRecommendationApi extends AdminRecommendationApi {
  private readonly respond = createMockResponder();
  private readonly state = inject(MockAdminState);
  private readonly store = inject(MockRecConfigStore);
  private readonly engine = inject(RecommendationEngine);

  config() {
    return this.respond.ok(() => {
      this.state.require('recommendation:manage');
      return this.store.read();
    });
  }

  saveConfig(input: Pick<RecConfig, 'strategies' | 'pinned' | 'excluded' | 'boosts' | 'minTogether'>) {
    return this.respond.okAsync<RecConfig>(async () => {
      const actor = this.state.require('recommendation:manage');
      const { products } = await loadCatalogData();
      const known = new Set(products.map((p) => p.id));
      const fields: Record<string, string> = {};
      const unknown = (ids: string[]) => ids.filter((id) => !known.has(id));
      if (unknown(input.pinned).length) fields['pinned'] = `Unknown product id: ${unknown(input.pinned).join(', ')}`;
      if (unknown(input.excluded).length) fields['excluded'] = `Unknown product id: ${unknown(input.excluded).join(', ')}`;
      const boostIds = Object.keys(input.boosts);
      if (unknown(boostIds).length) fields['boosts'] = `Unknown product id: ${unknown(boostIds).join(', ')}`;
      else if (Object.values(input.boosts).some((b) => !Number.isFinite(b) || b < 0.1 || b > 10)) fields['boosts'] = 'Each boost must be between 0.1 and 10';
      if (!Number.isInteger(input.minTogether) || input.minTogether < 1 || input.minTogether > 50) fields['minTogether'] = 'Enter a whole number from 1 to 50';
      if (input.pinned.some((id) => input.excluded.includes(id))) fields['pinned'] = 'A product cannot be both pinned and excluded';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const next: RecConfig = { ...input, pinned: [...new Set(input.pinned)], excluded: [...new Set(input.excluded)], updatedAt: new Date().toISOString(), updatedBy: actor.name };
      this.store.write(next);
      this.state.record('recommendations.config', 'config', `${Object.values(next.strategies).filter(Boolean).length} strategies on, ${next.pinned.length} pinned, ${next.excluded.length} excluded, ${Object.keys(next.boosts).length} boosted`);
      return next;
    });
  }

  preview(productId?: string) {
    return this.respond.okAsync<RecPreview>(async () => {
      this.state.require('recommendation:manage');
      const stats = await this.engine.stats();
      if (productId) {
        const { similar, together } = await this.engine.forProduct(productId);
        return { rows: [similar, together].filter((r): r is RecRow => !!r), stats };
      }
      const { personalised, trending, bestSellers } = await this.engine.home(undefined, false);
      return { rows: [personalised, trending, bestSellers].filter((r): r is RecRow => !!r), stats };
    });
  }

  stats() {
    return this.respond.okAsync<RecStats>(async () => {
      this.state.require('recommendation:manage');
      return this.engine.stats();
    });
  }
}
