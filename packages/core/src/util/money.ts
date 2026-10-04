// The implementations now live in @ecom/contracts (money-format.ts) so apps/api can use them too,
// without pulling in this Angular-oriented shared lib. Re-exported here so existing imports keep working.
export { formatMoney, discountPercent } from '@ecom/contracts';
