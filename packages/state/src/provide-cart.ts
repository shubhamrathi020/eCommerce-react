import { EnvironmentProviders, makeEnvironmentProviders } from '@shop/core';
import { CART_FACADE } from '@shop/core';
import { CartStore } from './cart.store';

/** Makes catalog "add to cart" buttons talk to the real cart store. */
export function provideCartFacade(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CART_FACADE, useExisting: CartStore }]);
}
