import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import { AddressBookApi, AuthApi, CartApi, CatalogApi, MockMailbox, OrderApi, PaymentApi, DEMO_ACCOUNTS, MAX_FAILED_ATTEMPTS, passwordProblem, provideDataAccess } from '../index';

const address = { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const input = { label: 'Home', name: 'Asha Rao', phone: '9876543210', address };
const demo = DEMO_ACCOUNTS[0];

describe('accounts (mock)', () => {
  let auth: AuthApi;
  let book: AddressBookApi;
  let cart: CartApi;
  let mailbox: MockMailbox;
  let variantId: string;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { useMocks: true, mockLatencyMs: 0, apiBaseUrl: '', siteName: 'S', siteUrl: 'http://x', features: {} } }, provideDataAccess({ useMocks: true })],
    });
    auth = TestBed.inject(AuthApi);
    book = TestBed.inject(AddressBookApi);
    cart = TestBed.inject(CartApi);
    mailbox = TestBed.inject(MockMailbox);
    const catalog = TestBed.inject(CatalogApi);
    const list = await firstValueFrom(catalog.listing({ filters: {}, sort: 'featured', page: 1, pageSize: 50 }));
    variantId = (await firstValueFrom(catalog.productsByIds(list.items.map((i) => i.id)))).flatMap((p) => p.variants).find((v) => v.stock >= 20)?.id ?? '';
  });

  it('enforces the password policy', () => {
    expect(passwordProblem('short')).toBeTruthy();
    expect(passwordProblem('alllowercase1')).toBeTruthy();
    expect(passwordProblem('Good1234')).toBeNull();
  });

  it('starts signed out and signs in a seeded demo customer with permissions', async () => {
    expect(await firstValueFrom(auth.me())).toBeNull();
    const session = await firstValueFrom(auth.login(demo.email.toUpperCase(), demo.password));
    expect(session.user.roles).toEqual(['customer']);
    expect(session.user.permissions).toContain('order:read:own');
    expect(session.user.permissions).not.toContain('product:write');
    expect((await firstValueFrom(auth.me()))?.user.email).toBe(demo.email);
    await firstValueFrom(auth.logout());
    expect(await firstValueFrom(auth.me())).toBeNull();
    const admin = await firstValueFrom(auth.login(DEMO_ACCOUNTS[1].email, DEMO_ACCOUNTS[1].password));
    expect(admin.user.permissions).toContain('product:write');
  });

  it('gives one generic message for wrong password and unknown email, then locks out after repeated failures', async () => {
    const unknown = await firstValueFrom(auth.login('nobody@example.com', 'Whatever1')).catch((e) => e);
    const wrong = await firstValueFrom(auth.login(demo.email, 'Wrong1234')).catch((e) => e);
    expect(unknown.message).toBe(wrong.message);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await firstValueFrom(auth.login(demo.email, 'Wrong1234')).catch(() => undefined);
    await expect(firstValueFrom(auth.login(demo.email, demo.password))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('registers with validation, neutral duplicate handling and a hashed password', async () => {
    await expect(firstValueFrom(auth.register({ name: '', email: 'x', password: 'weak' }))).rejects.toMatchObject({ code: 'validation', fields: { name: expect.any(String), email: expect.any(String), password: expect.any(String) } });
    const session = await firstValueFrom(auth.register({ name: 'Asha Rao', email: 'Asha@Example.com', password: 'Str0ngPass' }));
    expect(session.user.emailVerified).toBe(false);
    expect(JSON.stringify(session)).not.toContain('Str0ngPass');
    expect(localStorage.getItem('ecom.mock.users.v1')).not.toContain('Str0ngPass');
    await firstValueFrom(auth.logout());
    await expect(firstValueFrom(auth.register({ name: 'Other', email: 'asha@example.com', password: 'Str0ngPass' }))).rejects.toMatchObject({ code: 'validation' });
  });

  it('verifies email through the mailbox link, once', async () => {
    await firstValueFrom(auth.register({ name: 'Asha', email: 'asha@example.com', password: 'Str0ngPass' }));
    const mail = mailbox.list().find((m) => m.subject.includes('Verify'));
    const token = new URL(mail?.link ?? '', 'http://x').searchParams.get('token') ?? '';
    await firstValueFrom(auth.verifyEmail(token));
    expect((await firstValueFrom(auth.me()))?.user.emailVerified).toBe(true);
    await expect(firstValueFrom(auth.verifyEmail(token))).rejects.toMatchObject({ code: 'validation' });
  });

  it('resets a password with a single-use link and never reveals whether the account exists', async () => {
    await firstValueFrom(auth.requestPasswordReset('nobody@example.com'));
    expect(mailbox.list()).toHaveLength(0);
    await firstValueFrom(auth.requestPasswordReset(demo.email));
    const token = new URL(mailbox.list()[0].link ?? '', 'http://x').searchParams.get('token') ?? '';
    await expect(firstValueFrom(auth.resetPassword(token, 'weak'))).rejects.toMatchObject({ code: 'validation' });
    await firstValueFrom(auth.resetPassword(token, 'NewPass123'));
    await expect(firstValueFrom(auth.resetPassword(token, 'Another123'))).rejects.toMatchObject({ code: 'validation' });
    await expect(firstValueFrom(auth.login(demo.email, demo.password))).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await firstValueFrom(auth.login(demo.email, 'NewPass123'))).user.email).toBe(demo.email);
  });

  it('updates profile and changes password only with the current one', async () => {
    await firstValueFrom(auth.login(demo.email, demo.password));
    const user = await firstValueFrom(auth.updateProfile({ name: 'New Name', phone: '9123456780' }));
    expect(user.name).toBe('New Name');
    await expect(firstValueFrom(auth.updateProfile({ name: 'X', phone: '123' }))).rejects.toMatchObject({ fields: { phone: expect.any(String) } });
    await expect(firstValueFrom(auth.changePassword('Wrong1234', 'NewPass123'))).rejects.toMatchObject({ code: 'validation' });
    await firstValueFrom(auth.changePassword(demo.password, 'NewPass123'));
    await firstValueFrom(auth.logout());
    expect((await firstValueFrom(auth.login(demo.email, 'NewPass123'))).user.name).toBe('New Name');
  });

  it('manages the address book: default handling, validation and sign-in requirement', async () => {
    await expect(firstValueFrom(book.list())).rejects.toMatchObject({ code: 'unauthorized' });
    await firstValueFrom(auth.login(demo.email, demo.password));
    await expect(firstValueFrom(book.add({ ...input, phone: '1' }))).rejects.toMatchObject({ code: 'validation' });
    let list = await firstValueFrom(book.add(input));
    expect(list[0].isDefault).toBe(true);
    list = await firstValueFrom(book.add({ ...input, label: 'Work' }));
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    list = await firstValueFrom(book.setDefault(list[1].id));
    expect(list[1].isDefault).toBe(true);
    list = await firstValueFrom(book.update(list[1].id, { ...input, label: 'Office' }));
    expect(list[1].label).toBe('Office');
    list = await firstValueFrom(book.remove(list[1].id));
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true); // default promoted
  });

  it('merges the guest cart into the account cart on sign in and shows an empty guest cart after sign out', async () => {
    await firstValueFrom(cart.add(variantId, 2));
    await firstValueFrom(auth.login(demo.email, demo.password));
    let c = await firstValueFrom(cart.get());
    expect(c.totals.itemCount).toBe(2);
    await firstValueFrom(cart.add(variantId, 1));
    await firstValueFrom(auth.logout());
    c = await firstValueFrom(cart.get());
    expect(c.lines).toHaveLength(0);
    await firstValueFrom(cart.add(variantId, 4));
    await firstValueFrom(auth.login(demo.email, demo.password));
    c = await firstValueFrom(cart.get());
    expect(c.lines[0].quantity).toBe(7); // 3 kept in the account + 4 from the guest cart
  });

  it('links orders to the account, lists them per owner, exports data and anonymises orders on deletion', async () => {
    const orders = TestBed.inject(OrderApi);
    const payments = TestBed.inject(PaymentApi);
    await firstValueFrom(auth.login(demo.email, demo.password));
    await firstValueFrom(cart.add(variantId, 1));
    const contact = { name: 'Demo Customer', email: demo.email, phone: '9876543210' };
    const order = await firstValueFrom(orders.place({ idempotencyKey: 'k1', contact, address, paymentMethod: 'cod' }));
    expect(order.userId).toBeDefined();
    expect(mailbox.list().some((m) => m.subject.includes(order.id))).toBe(true);
    expect((await firstValueFrom(orders.list())).map((o) => o.id)).toEqual([order.id]);

    const dump = await firstValueFrom(auth.exportData());
    expect(dump.orderIds).toEqual([order.id]);
    expect(JSON.stringify(dump)).not.toContain('passwordHash');

    await firstValueFrom(auth.logout());
    expect(await firstValueFrom(orders.list())).toHaveLength(0); // guest device sees only guest orders

    await firstValueFrom(auth.login(demo.email, demo.password));
    await expect(firstValueFrom(auth.deleteAccount('Wrong1234'))).rejects.toMatchObject({ code: 'validation' });
    await firstValueFrom(auth.deleteAccount(demo.password));
    expect(await firstValueFrom(auth.me())).toBeNull();
    await expect(firstValueFrom(auth.login(demo.email, demo.password))).rejects.toMatchObject({ code: 'unauthorized' });
    const kept = await firstValueFrom(orders.get(order.id));
    expect(kept.userId).toBeUndefined();
    expect(kept.contact.name).toBe('Deleted customer');
    expect(payments).toBeTruthy();
  });
});
