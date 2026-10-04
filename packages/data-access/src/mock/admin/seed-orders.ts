import type { Order, OrderStatus, PaymentStatus, Product, TimelineEntry } from '@ecom/contracts';
import { priceCart } from '../cart-engine';

export const SEED_CUSTOMERS = [
  { id: 'usr_seed_1', name: 'Aarav Sharma', email: 'aarav.sharma@example.com', phone: '9810000001' },
  { id: 'usr_seed_2', name: 'Diya Menon', email: 'diya.menon@example.com', phone: '9810000002' },
  { id: 'usr_seed_3', name: 'Rohan Kulkarni', email: 'rohan.k@example.com', phone: '9810000003' },
  { id: 'usr_seed_4', name: 'Ananya Iyer', email: 'ananya.iyer@example.com', phone: '9810000004' },
  { id: 'usr_seed_5', name: 'Vihaan Reddy', email: 'vihaan.r@example.com', phone: '9810000005' },
  { id: 'usr_seed_6', name: 'Ishita Gupta', email: 'ishita.g@example.com', phone: '9810000006' },
  { id: 'usr_seed_7', name: 'Kabir Nair', email: 'kabir.nair@example.com', phone: '9810000007' },
  { id: 'usr_seed_8', name: 'Meera Thomas', email: 'meera.t@example.com', phone: '9810000008' },
  { id: 'usr_seed_9', name: 'Arjun Das', email: 'arjun.das@example.com', phone: '9810000009' },
  { id: 'usr_seed_10', name: 'Sneha Bose', email: 'sneha.b@example.com', phone: '9810000010' },
  { id: 'usr_seed_11', name: 'Rahul Verma', email: 'rahul.v@example.com', phone: '9810000011' },
  { id: 'usr_seed_12', name: 'Priya Lal', email: 'priya.l@example.com', phone: '9810000012' },
];

const CITIES = [
  { city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  { city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  { city: 'Delhi', state: 'Delhi', pincode: '110001' },
  { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  { city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FLOW: OrderStatus[] = ['confirmed', 'packed', 'shipped', 'delivered'];
const LABEL: Record<string, string> = { placed: 'Order placed', paid: 'Payment received', confirmed: 'Order confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Order cancelled' };

/** Deterministic demo orders spread over the last 30 days (same output for the same `now` day). */
export function seedOrders(products: Product[], now: number, count = 60): Order[] {
  const rnd = mulberry32(7);
  const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
  const inStock = products.filter((p) => p.variants.some((v) => v.stock > 3));
  const orders: Order[] = [];

  for (let i = 0; i < count; i++) {
    const ageDays = Math.floor(rnd() * rnd() * 30 * 1.6) % 30; // more recent orders are more common
    const createdMs = now - ageDays * DAY - int(0, 20) * HOUR;
    const customer = SEED_CUSTOMERS[int(0, SEED_CUSTOMERS.length - 1)];
    const items = Array.from({ length: int(1, 3) }, () => {
      const p = inStock[int(0, inStock.length - 1)];
      const v = p.variants.filter((x) => x.stock > 3)[0];
      return { variantId: v.id, quantity: int(1, 2), seenPrice: v.price.amount };
    }).filter((it, idx, all) => all.findIndex((x) => x.variantId === it.variantId) === idx);

    const withCoupon = rnd() < 0.25;
    const { cart } = priceCart({ items, shippingMethod: rnd() < 0.2 ? 'express' : 'standard', ...(withCoupon ? { couponCode: 'WELCOME10' } : {}) }, products, createdMs);
    if (cart.lines.length === 0) continue;

    const cod = rnd() < 0.35 && cart.totals.total.amount <= 500_000;
    const roll = rnd();
    let status: OrderStatus;
    if (ageDays === 0) status = roll < 0.3 ? 'pending_payment' : 'confirmed';
    else if (ageDays <= 2) status = roll < 0.1 ? 'cancelled' : roll < 0.5 ? 'confirmed' : 'packed';
    else if (ageDays <= 6) status = roll < 0.08 ? 'cancelled' : roll < 0.55 ? 'shipped' : 'delivered';
    else status = roll < 0.1 ? 'cancelled' : 'delivered';
    if (cod && status === 'pending_payment') status = 'confirmed';

    const placed: TimelineEntry[] = [{ status: 'placed', label: LABEL['placed'], at: new Date(createdMs).toISOString() }];
    let paymentStatus: PaymentStatus = cod ? 'cod' : 'pending';
    let t = createdMs;
    if (status !== 'pending_payment') {
      if (!cod && status !== 'cancelled') {
        t += 0.1 * HOUR;
        placed.push({ status: 'paid', label: LABEL['paid'], at: new Date(t).toISOString() });
        paymentStatus = 'paid';
      }
      if (status !== 'cancelled') {
        for (const step of FLOW.slice(0, FLOW.indexOf(status) + 1)) {
          t += (step === 'confirmed' ? 0.1 : 8) * HOUR;
          placed.push({ status: step, label: LABEL[step], at: new Date(t).toISOString() });
        }
      }
    }
    if (status === 'cancelled') {
      placed.push({ status: 'cancelled', label: LABEL['cancelled'], at: new Date(createdMs + 3 * HOUR).toISOString() });
      paymentStatus = cod ? 'cod' : 'pending';
    }

    const where = CITIES[int(0, CITIES.length - 1)];
    orders.push({
      id: `ORD-DEMO${String(i + 1).padStart(3, '0')}`,
      status,
      paymentStatus,
      paymentMethod: cod ? 'cod' : 'razorpay',
      lines: cart.lines,
      totals: cart.totals,
      ...(cart.coupon ? { couponCode: cart.coupon.code } : {}),
      shippingMethod: cart.shippingMethod,
      contact: { name: customer.name, email: customer.email, phone: customer.phone },
      address: { line1: `${int(1, 300)} Main Road`, ...where },
      timeline: placed,
      createdAt: new Date(createdMs).toISOString(),
      userId: customer.id,
    });
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
