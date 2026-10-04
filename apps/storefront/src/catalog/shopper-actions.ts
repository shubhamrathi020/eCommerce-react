import { CART_FACADE, CompareStore, Injectable, ToastService, WishlistStore, inject } from '@shop/core';
import type { ProductSummary } from '@ecom/contracts';

/** Card-level actions (wishlist, compare, quick add) shared by every product list. */
@Injectable({ providedIn: 'root' })
export class ShopperActions {
  private readonly wishlist = inject(WishlistStore);
  private readonly compare = inject(CompareStore);
  private readonly cart = inject(CART_FACADE);
  private readonly toast = inject(ToastService);

  readonly wishlistIds = this.wishlist.ids;
  readonly compareIds = this.compare.ids;

  toggleWishlist(product: ProductSummary): void {
    const added = this.wishlist.toggle(product.id);
    this.toast.success(added ? 'Added to your wishlist' : 'Removed from your wishlist');
  }

  toggleCompare(product: ProductSummary): void {
    if (this.compare.has(product.id)) {
      this.compare.remove(product.id);
    } else if (!this.compare.add(product.id)) {
      this.toast.error(`You can compare up to ${this.compare.limit} products. Remove one first.`);
    }
  }

  quickAdd(product: ProductSummary): void {
    if (!product.quickAddVariantId) return;
    void this.cart.add({ productId: product.id, variantId: product.quickAddVariantId, quantity: 1, title: product.title });
  }
}
