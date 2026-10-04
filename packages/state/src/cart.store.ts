import { Injectable, computed, inject, signal } from '@shop/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { AnalyticsService, type AddToCartRequest, type CartFacade, ToastService } from '@shop/core';
import { CartApi } from '@shop/data-access';
import type { Cart, ShippingMethodId } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';

export interface CartResult {
  ok: boolean;
  /** User-readable failure message. */
  message?: string;
}

/**
 * App-wide cart state. The cart itself is owned by `CartApi` (server-side); this store holds the latest
 * priced snapshot and exposes signals. It never computes money.
 */
@Injectable({ providedIn: 'root' })
export class CartStore implements CartFacade {
  private readonly api = inject(CartApi);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly browser = typeof window !== 'undefined';

  private readonly _cart = signal<Cart | null>(null);
  private readonly _busy = signal(false);
  private readonly _loaded = signal(false);

  readonly cart = this._cart.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly lines = computed(() => this._cart()?.lines ?? []);
  readonly count = computed(() => this._cart()?.totals.itemCount ?? 0);
  readonly isEmpty = computed(() => this.lines().length === 0);
  /** Bound to the mini-cart drawer. */
  readonly miniCartOpen = signal(false);

  constructor() {
    // The cart lives in the browser session; the server renders an empty header badge.
    if (this.browser) void this.refresh();
  }

  async refresh(): Promise<void> {
    await this.run(this.api.get());
    this._loaded.set(true);
  }

  async add(request: AddToCartRequest): Promise<boolean> {
    const result = await this.run(this.api.add(request.variantId, request.quantity));
    if (!result.ok) {
      this.toast.error(result.message ?? 'Could not add to cart.');
      return false;
    }
    const added = this._cart()?.lines.find((l) => l.variantId === request.variantId);
    if (added) this.analytics.track({ name: 'add_to_cart', props: { productId: added.productId, quantity: request.quantity } });
    if (request.openMiniCart !== false) this.miniCartOpen.set(true);
    else this.toast.success('Added to cart');
    return true;
  }

  setQuantity(variantId: string, quantity: number): Promise<CartResult> {
    return this.run(this.api.setQuantity(variantId, quantity));
  }

  async remove(variantId: string, title?: string): Promise<CartResult> {
    const result = await this.run(this.api.remove(variantId));
    if (result.ok && title) this.toast.info(`Removed "${title}" from your cart`);
    return result;
  }

  applyCoupon(code: string): Promise<CartResult> {
    return this.run(this.api.applyCoupon(code));
  }

  removeCoupon(): Promise<CartResult> {
    return this.run(this.api.removeCoupon());
  }

  setShippingMethod(method: ShippingMethodId): Promise<CartResult> {
    return this.run(this.api.setShippingMethod(method));
  }

  private async run(request: Observable<Cart>): Promise<CartResult> {
    this._busy.set(true);
    try {
      this._cart.set(await firstValueFrom(request));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof ApiException ? error.message : 'Something went wrong. Please try again.' };
    } finally {
      this._busy.set(false);
    }
  }
}
