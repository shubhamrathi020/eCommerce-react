import { Injectable, inject } from '@shop/core';
import type { AccountExport, RegisterRequest, Session, User } from '@ecom/contracts';
import { ApiException, passwordProblem } from '@ecom/contracts';
import { AuthApi } from '../lib/account.api';
import { MockAddressStore } from './mock-address-book.api';
import { MockCartState } from './mock-cart-state';
import { createMockResponder } from './mock-latency';
import { MockMailbox } from './mock-mailbox';
import { MockOrderStore } from './mock-order-store';
import { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, MockUserStore, type StoredUser, hashPassword, randomToken, toUser } from './mock-user-store';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[6-9][0-9]{9}$/;
const RESET_MINUTES = 30;
const MINUTE = 60_000;

/** The policy lives in `@ecom/contracts` so the real API enforces exactly the same rule. */
export { passwordProblem };

@Injectable()
export class MockAuthApi extends AuthApi {
  private readonly respond = createMockResponder();
  private readonly users = inject(MockUserStore);
  private readonly mailbox = inject(MockMailbox);
  private readonly carts = inject(MockCartState);
  private readonly orders = inject(MockOrderStore);
  private readonly addresses = inject(MockAddressStore);

  private currentUser(): StoredUser {
    const id = this.users.currentUserId();
    const user = id ? this.users.users().find((u) => u.id === id) : undefined;
    if (!user) throw new ApiException('unauthorized', 'Please sign in.');
    return user;
  }

  me() {
    return this.respond.okAsync<Session | null>(async () => {
      await this.users.ensureSeeded();
      return this.users.session();
    });
  }

  register(request: RegisterRequest) {
    return this.respond.okAsync<Session>(async () => {
      await this.users.ensureSeeded();
      const fields: Record<string, string> = {};
      if (!request.name.trim()) fields['name'] = 'Name is required';
      if (!EMAIL.test(request.email.trim())) fields['email'] = 'Enter a valid email address';
      const problem = passwordProblem(request.password);
      if (problem) fields['password'] = problem;
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      if (this.users.findByEmail(request.email)) {
        // Neutral wording: do not confirm that the address is already registered.
        throw new ApiException('validation', 'We could not create the account with these details. If you already have an account, sign in or reset your password.');
      }
      const salt = randomToken();
      const user: StoredUser = {
        id: `usr_${randomToken().slice(0, 12)}`,
        name: request.name.trim(),
        email: request.email.trim().toLowerCase(),
        roles: ['customer'],
        emailVerified: false,
        createdAt: new Date().toISOString(),
        salt,
        passwordHash: await hashPassword(request.password, salt),
        verifyToken: randomToken(),
      };
      this.users.saveUsers([...this.users.users(), user]);
      const session = this.users.startSession(user);
      this.carts.mergeGuestIntoUser(user.id);
      this.mailbox.send({ to: user.email, subject: 'Verify your email address', body: `Hi ${user.name}, please confirm your email address to finish setting up your account.`, link: `/account/verify-email?token=${user.verifyToken}` });
      return session;
    });
  }

  login(email: string, password: string) {
    return this.respond.okAsync<Session>(async () => {
      await this.users.ensureSeeded();
      const now = Date.now();
      const attempts = this.users.attemptsFor(email);
      if (attempts?.lockedUntil && attempts.lockedUntil > now) {
        const minutes = Math.max(1, Math.ceil((attempts.lockedUntil - now) / MINUTE));
        throw new ApiException('forbidden', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      }
      const user = this.users.findByEmail(email);
      // Hash even when the account does not exist so timing does not reveal it.
      const hash = await hashPassword(password, user?.salt ?? 'no-such-user');
      if (!user || hash !== user.passwordHash) {
        const fresh = !attempts || now - attempts.firstAt > LOCKOUT_MINUTES * MINUTE;
        const count = fresh ? 1 : attempts.count + 1;
        this.users.saveAttempts(email, { count, firstAt: fresh ? now : attempts.firstAt, ...(count >= MAX_FAILED_ATTEMPTS ? { lockedUntil: now + LOCKOUT_MINUTES * MINUTE } : {}) });
        throw new ApiException('unauthorized', 'Incorrect email or password.');
      }
      this.users.saveAttempts(email, null);
      const session = this.users.startSession(user);
      this.carts.mergeGuestIntoUser(user.id);
      return session;
    });
  }

  logout() {
    return this.respond.okAsync<void>(async () => this.users.endSession());
  }

  verifyEmail(token: string) {
    return this.respond.okAsync<void>(async () => {
      await this.users.ensureSeeded();
      const user = this.users.users().find((u) => u.verifyToken && u.verifyToken === token);
      if (!user) throw new ApiException('validation', 'This verification link is invalid or has already been used.');
      const { verifyToken: _used, ...rest } = user;
      this.users.update({ ...rest, emailVerified: true });
    });
  }

  requestPasswordReset(email: string) {
    return this.respond.okAsync<void>(async () => {
      await this.users.ensureSeeded();
      const user = this.users.findByEmail(email);
      if (!user) return; // same outcome either way
      const reset = { token: randomToken(), expiresAt: new Date(Date.now() + RESET_MINUTES * MINUTE).toISOString() };
      this.users.update({ ...user, reset });
      this.mailbox.send({ to: user.email, subject: 'Reset your password', body: `Use this link within ${RESET_MINUTES} minutes to choose a new password. If you did not ask for it, ignore this email.`, link: `/account/reset-password?token=${reset.token}` });
    });
  }

  resetPassword(token: string, newPassword: string) {
    return this.respond.okAsync<void>(async () => {
      await this.users.ensureSeeded();
      const problem = passwordProblem(newPassword);
      if (problem) throw new ApiException('validation', problem, { password: problem });
      const user = this.users.users().find((u) => u.reset?.token === token);
      if (!user?.reset || new Date(user.reset.expiresAt).getTime() < Date.now()) throw new ApiException('validation', 'This reset link is invalid or has expired.');
      const { reset: _used, ...rest } = user;
      const salt = randomToken();
      this.users.update({ ...rest, salt, passwordHash: await hashPassword(newPassword, salt) });
      this.users.saveAttempts(user.email, null);
    });
  }

  updateProfile(changes: { name: string; phone?: string }) {
    return this.respond.okAsync<User>(async () => {
      const user = this.currentUser();
      const fields: Record<string, string> = {};
      if (!changes.name.trim()) fields['name'] = 'Name is required';
      if (changes.phone && !PHONE.test(changes.phone)) fields['phone'] = 'Enter a valid 10-digit mobile number';
      if (Object.keys(fields).length) throw new ApiException('validation', 'Please check the highlighted fields.', fields);
      const { phone: _old, ...rest } = user;
      const updated: StoredUser = { ...rest, name: changes.name.trim(), ...(changes.phone ? { phone: changes.phone } : {}) };
      this.users.update(updated);
      return toUser(updated);
    });
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.respond.okAsync<void>(async () => {
      const user = this.currentUser();
      if ((await hashPassword(currentPassword, user.salt)) !== user.passwordHash) throw new ApiException('validation', 'Your current password is incorrect.', { currentPassword: 'Incorrect password' });
      const problem = passwordProblem(newPassword);
      if (problem) throw new ApiException('validation', problem, { newPassword: problem });
      const salt = randomToken();
      this.users.update({ ...user, salt, passwordHash: await hashPassword(newPassword, salt) });
    });
  }

  exportData() {
    return this.respond.okAsync<AccountExport>(async () => {
      const user = this.currentUser();
      const { permissions: _p, ...profile } = toUser(user);
      return { exportedAt: new Date().toISOString(), profile, addresses: this.addresses.list(user.id), orderIds: this.orders.all().filter((o) => o.userId === user.id).map((o) => o.id) };
    });
  }

  deleteAccount(password: string) {
    return this.respond.okAsync<void>(async () => {
      const user = this.currentUser();
      if ((await hashPassword(password, user.salt)) !== user.passwordHash) throw new ApiException('validation', 'That password is not correct.', { password: 'Incorrect password' });
      this.users.saveUsers(this.users.users().filter((u) => u.id !== user.id));
      this.addresses.removeAll(user.id);
      this.orders.anonymise(user.id);
      this.carts.removeUserCart(user.id);
      this.users.endSession();
    });
  }
}
