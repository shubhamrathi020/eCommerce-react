import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useService } from '@shop/core';
import { CartStore } from '@shop/state';

/**
 * Sends shoppers with an empty cart back to the cart page. Like a route guard it decides once, when the route is entered: placing
 * the order empties the cart while the page is still showing, and that must not bounce the shopper away from their confirmation.
 */
export function CartNotEmpty({ children }: { children: ReactNode }) {
  const store = useService(CartStore);
  const [decision, setDecision] = useState<'pending' | 'allow' | 'empty'>('pending');
  useEffect(() => {
    let current = true;
    void store.refresh().then(() => current && setDecision(store.isEmpty() ? 'empty' : 'allow'));
    return () => {
      current = false;
    };
  }, [store]);
  if (decision === 'pending') return null;
  return decision === 'empty' ? <Navigate to="/cart" replace /> : <>{children}</>;
}
