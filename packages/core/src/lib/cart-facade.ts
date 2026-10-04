import { Injectable, InjectionToken, inject } from '../runtime';
import { ToastService } from './toast.service';

export interface AddToCartRequest {
  productId: string;
  variantId: string;
  quantity: number;
  title: string;
  /** Set false for "Buy now", which goes straight to checkout instead of opening the mini-cart. */
  openMiniCart?: boolean;
}

/** What catalog UI needs from the cart. The cart state library provides the real implementation. */
export interface CartFacade {
  /** Resolves true when the item was added. */
  add(request: AddToCartRequest): Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
class PlaceholderCartFacade implements CartFacade {
  private readonly toast = inject(ToastService);

  async add(request: AddToCartRequest): Promise<boolean> {
    this.toast.info(`"${request.title}" will be added to your cart once the cart module ships.`);
    return false;
  }
}

export const CART_FACADE = new InjectionToken<CartFacade>('CART_FACADE', {
  providedIn: 'root',
  factory: () => inject(PlaceholderCartFacade),
});
