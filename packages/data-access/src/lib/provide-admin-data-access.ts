import { EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { AdminContentApi } from './content.api';
import { AdminInventoryApi } from './inventory.api';
import { AdminNotificationApi } from './notification.api';
import { AdminReturnApi, AdminSupportApi } from './returns.api';
import { AdminGiftCardApi, AdminPromotionApi } from './promotion.api';
import { AdminRecommendationApi } from './recommendation.api';
import { AdminAnalyticsApi } from './analytics.api';
import { AdminSellerApi } from './marketplace.api';
import { MockAdminSellerApi } from '../mock/admin/mock-admin-seller.api';
import { MockAdminAnalyticsApi } from '../mock/admin/mock-admin-analytics.api';
import { MockAdminRecommendationApi } from '../mock/mock-recommendation.api';
import { MockAdminGiftCardApi, MockAdminPromotionApi } from '../mock/admin/mock-admin-promotion.api';
import { MockAdminReturnApi, MockAdminSupportApi } from '../mock/admin/mock-admin-returns.api';
import { MockAdminInventoryApi } from '../mock/admin/mock-admin-inventory.api';
import { MockAdminNotificationApi } from '../mock/admin/mock-admin-notification.api';
import { MockAdminContentApi } from '../mock/admin/mock-admin-content.api';
import { AdminCouponApi, AdminDashboardApi, AdminOrderApi, AdminProductApi, AdminReviewApi, AdminUserApi, AuditApi } from './admin.api';
import { MockAdminCouponApi, MockAdminDashboardApi, MockAdminOrderApi, MockAdminProductApi, MockAdminReviewApi, MockAdminUserApi, MockAuditApi } from '../mock/admin/mock-admin.api';
import { HttpAdminProductApi } from '../http/http-admin-catalog.api';
import { HttpAdminOrderApi } from '../http/http-admin-order.api';

/**
 * Back-office adapters. Only the admin app provides these, so the storefront bundle stays free of them.
 * `realCatalog`/`realCommerce: true` need `realAuth: true` too — the Http admin adapters call the real API
 * as the signed-in user, so without a real access token every call is refused as unauthorized.
 */
export function provideAdminDataAccess(options: { useMocks: boolean; realCatalog?: boolean; realCommerce?: boolean }): EnvironmentProviders {
  if (!options.useMocks) throw new Error('Only catalog/search (BRD 20) and orders (BRD 21) have a real API so far. Keep useMocks: true and set realCatalog/realCommerce: true to use them.');
  return makeEnvironmentProviders([
    { provide: AdminProductApi, useClass: options.realCatalog ? HttpAdminProductApi : MockAdminProductApi },
    { provide: AdminOrderApi, useClass: options.realCommerce ? HttpAdminOrderApi : MockAdminOrderApi },
    { provide: AdminCouponApi, useClass: MockAdminCouponApi },
    { provide: AdminUserApi, useClass: MockAdminUserApi },
    { provide: AdminContentApi, useClass: MockAdminContentApi },
    { provide: AdminInventoryApi, useClass: MockAdminInventoryApi },
    { provide: AdminNotificationApi, useClass: MockAdminNotificationApi },
    { provide: AdminReturnApi, useClass: MockAdminReturnApi },
    { provide: AdminSupportApi, useClass: MockAdminSupportApi },
    { provide: AdminPromotionApi, useClass: MockAdminPromotionApi },
    { provide: AdminGiftCardApi, useClass: MockAdminGiftCardApi },
    { provide: AdminRecommendationApi, useClass: MockAdminRecommendationApi },
    { provide: AdminAnalyticsApi, useClass: MockAdminAnalyticsApi },
    { provide: AdminSellerApi, useClass: MockAdminSellerApi },
    { provide: AdminReviewApi, useClass: MockAdminReviewApi },
    { provide: AdminDashboardApi, useClass: MockAdminDashboardApi },
    { provide: AuditApi, useClass: MockAuditApi },
  ]);
}
