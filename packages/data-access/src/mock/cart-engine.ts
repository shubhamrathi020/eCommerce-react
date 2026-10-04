// The pricing rules now live in @ecom/contracts (cart-derive.ts) so apps/api can use them too — the
// same pattern as catalog-engine.ts's relocation in BRD 20. Re-exported here so existing imports keep working.
export {
  COD_MAX_TOTAL,
  COUPONS,
  EMPTY_STORED_CART,
  EXPRESS_SHIPPING,
  FREE_SHIPPING_THRESHOLD,
  MAX_LINE_QUANTITY,
  STANDARD_SHIPPING,
  evaluateCoupon,
  gstRateFor,
  priceCart,
  shippingFee,
  type Coupon,
  type CouponResult,
  type PricedCart,
  type PricingExtras,
  type StoredCart,
} from '@ecom/contracts';
