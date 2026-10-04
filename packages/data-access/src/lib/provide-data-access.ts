import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@shop/core';
import { EVENT_SINK } from '@shop/core';
import { AddressBookApi, AuthApi } from './account.api';
import { CatalogApi } from './catalog.api';
import { CartApi, CheckoutApi, OrderApi, PaymentApi } from './commerce.api';
import { CategoryApi } from './category.api';
import { CmsApi } from './cms.api';
import { ContentApi } from './content.api';
import { ReviewApi } from './review.api';
import { SearchApi } from './search.api';
import { NewsletterApi } from './newsletter.api';
import { AlertApi, NotificationApi, PreferenceApi } from './notification.api';
import { ReturnApi, SupportApi } from './returns.api';
import { PromotionApi, WalletApi } from './promotion.api';
import { RecommendationApi } from './recommendation.api';
import { SellerPortalApi, SellerPublicApi } from './marketplace.api';
import { MockSellerPortalApi, MockSellerPublicApi } from '../mock/mock-seller.api';
import { MockSellerStore } from '../mock/seller-store';
import { MockEventStore } from '../mock/event-store';
import { MockRecommendationApi } from '../mock/mock-recommendation.api';
import { MockPromotionApi, MockWalletApi } from '../mock/mock-promotion.api';
import { MockReturnApi, MockSupportApi } from '../mock/mock-return.api';
import { MockAddressBookApi } from '../mock/mock-address-book.api';
import { MockAuthApi } from '../mock/mock-auth.api';
import { MockCartApi } from '../mock/mock-cart.api';
import { MockCatalogApi } from '../mock/mock-catalog.api';
import { MockCheckoutApi } from '../mock/mock-checkout.api';
import { MockOrderApi } from '../mock/mock-order.api';
import { MockSearchApi } from '../mock/mock-search.api';
import { MockReviewApi } from '../mock/mock-review.api';
import { MockPaymentApi } from '../mock/mock-payment.api';
import { MockCategoryApi } from '../mock/mock-category.api';
import { MockCmsApi, MockContentApi } from '../mock/mock-content.api';
import { MockNewsletterApi } from '../mock/mock-newsletter.api';
import { MockAlertApi, MockNotificationApi, MockPreferenceApi } from '../mock/mock-notification.api';
import { HttpAddressBookApi, HttpAuthApi } from '../http/http-auth.api';
import { HttpCatalogApi, HttpCategoryApi, HttpSearchApi } from '../http/http-catalog.api';
import { HttpCartApi, HttpCheckoutApi, HttpOrderApi, HttpPaymentApi } from '../http/http-commerce.api';

/**
 * Wires each API contract to its adapter, selected by `AppConfig.useMocks` and, module by module, the
 * `realAuth`/`realCatalog`/`realCommerce` flags as each backend BRD lands. Everything not yet listed with
 * a `real...` flag still has no HTTP adapter at all and stays on mocks.
 */
export function provideDataAccess(options: { useMocks: boolean; realAuth?: boolean; realCatalog?: boolean; realCommerce?: boolean }): EnvironmentProviders {
  if (!options.useMocks) {
    throw new Error('Only identity (BRD 19), catalog/search (BRD 20) and commerce (BRD 21) have a real API so far. Keep useMocks: true and set realAuth/realCatalog/realCommerce: true to use them.');
  }
  return makeEnvironmentProviders([
    // Identity (BRD 19), catalog/search (BRD 20) and commerce (BRD 21) are the only modules with a real
    // backend so far; everything else stays on mocks until its own BRD lands.
    { provide: CatalogApi, useClass: options.realCatalog ? HttpCatalogApi : MockCatalogApi },
    { provide: AuthApi, useClass: options.realAuth ? HttpAuthApi : MockAuthApi },
    { provide: AddressBookApi, useClass: options.realAuth ? HttpAddressBookApi : MockAddressBookApi },
    // ReviewApi is only the *writing* side (submit/vote/moderate); reading reviews is CatalogApi.reviews(),
    // which already goes real with realCatalog. A review submitted through the still-mock ReviewApi will
    // not appear there until BRD 20's reviews write-path is built for real (a recorded, not silent, gap).
    { provide: ReviewApi, useClass: MockReviewApi },
    { provide: SearchApi, useClass: options.realCatalog ? HttpSearchApi : MockSearchApi },
    { provide: CartApi, useClass: options.realCommerce ? HttpCartApi : MockCartApi },
    { provide: CheckoutApi, useClass: options.realCommerce ? HttpCheckoutApi : MockCheckoutApi },
    { provide: OrderApi, useClass: options.realCommerce ? HttpOrderApi : MockOrderApi },
    // Online payments through PaymentApi only actually succeed once the server has its own Razorpay
    // test-mode keys; cash on delivery (which never touches PaymentApi) works either way.
    { provide: PaymentApi, useClass: options.realCommerce ? HttpPaymentApi : MockPaymentApi },
    { provide: CategoryApi, useClass: options.realCatalog ? HttpCategoryApi : MockCategoryApi },
    { provide: CmsApi, useClass: MockCmsApi },
    { provide: ContentApi, useClass: MockContentApi },
    { provide: NewsletterApi, useClass: MockNewsletterApi },
    { provide: PreferenceApi, useClass: MockPreferenceApi },
    { provide: AlertApi, useClass: MockAlertApi },
    { provide: NotificationApi, useClass: MockNotificationApi },
    // Returns, refunds and support (BRD 13): mock only. They read orders from the device-local order store, so with
    // realCommerce on they cannot see backend orders yet (recorded in the BRD 13 change log).
    { provide: ReturnApi, useClass: MockReturnApi },
    { provide: SupportApi, useClass: MockSupportApi },
    // Promotions, flash deals, gift cards and store credit (BRD 14): mock only. With realCommerce the real cart
    // does not run the promotion engine yet, so these show nothing there (recorded in the BRD 14 change log).
    { provide: PromotionApi, useClass: MockPromotionApi },
    { provide: WalletApi, useClass: MockWalletApi },
    // Behaviour events and recommendations (BRD 15): mock only. The sink stores anonymous events on this device.
    { provide: RecommendationApi, useClass: MockRecommendationApi },
    // Marketplace (BRD 17): mock only. Creating the seller store at start-up registers it with the catalog, so approved
    // seller listings and seller ownership reach every shop and cart read.
    provideEnvironmentInitializer(() => void inject(MockSellerStore)),
    { provide: SellerPublicApi, useClass: MockSellerPublicApi },
    { provide: SellerPortalApi, useClass: MockSellerPortalApi },
    {
      provide: EVENT_SINK,
      useFactory: () => {
        const store = inject(MockEventStore);
        return (event: Parameters<MockEventStore['add']>[0]) => store.add(event);
      },
    },
  ]);
}
