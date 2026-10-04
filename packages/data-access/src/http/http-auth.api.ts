import { Injectable, inject } from '@shop/core';
import type { AccountExport, RegisterRequest, SavedAddress, Session, User } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { type Observable, catchError, firstValueFrom, map, of, tap } from 'rxjs';
import { type AddressInput, AddressBookApi, AuthApi } from '../lib/account.api';
import { MockCartState } from '../mock/mock-cart-state';
import { MockUserStore } from '../mock/mock-user-store';
import { ApiClient } from './api-client';

interface SignInResponse {
  session: Session;
  accessToken: string;
}

/**
 * `AuthApi` against the real backend (BRD 19). Same contract as `MockAuthApi`, so no page changes. While the
 * rest of the shop still runs on mocks, every session change is mirrored into the mock user store so the
 * mock cart, orders and admin screens stay consistent (see `MockUserStore.mirrorSession`).
 */
@Injectable()
export class HttpAuthApi extends AuthApi {
  private readonly api = inject(ApiClient);
  private readonly mockUsers = inject(MockUserStore);
  private readonly carts = inject(MockCartState);

  constructor() {
    super();
    this.api.refreshWith(async () => (await firstValueFrom(this.refresh())).accessToken);
  }

  private refresh(): Observable<SignInResponse> {
    return this.api.public<SignInResponse>('POST', '/auth/refresh').pipe(tap((res) => this.signedIn(res)));
  }

  private signedIn(res: SignInResponse, freshSignIn = false): Session {
    this.api.setAccessToken(res.accessToken);
    this.mockUsers.mirrorSession(res.session);
    // Same as the mock: a guest's cart joins the account's cart on an actual sign-in (not on a silent refresh).
    if (freshSignIn) this.carts.mergeGuestIntoUser(res.session.user.id);
    return res.session;
  }

  private signedOut(): void {
    this.api.setAccessToken(null);
    this.mockUsers.endSession();
  }

  /** A page load has no access token in memory: the refresh cookie (if any) restores the session. */
  me(): Observable<Session | null> {
    return this.refresh().pipe(
      map((res) => res.session),
      catchError((e: ApiException) => {
        if (e.code !== 'unauthorized' && e.code !== 'forbidden') throw e;
        this.signedOut();
        return of(null);
      }),
    );
  }

  register(request: RegisterRequest): Observable<Session> {
    return this.api.public<SignInResponse>('POST', '/auth/register', request).pipe(map((res) => this.signedIn(res, true)));
  }

  login(email: string, password: string): Observable<Session> {
    return this.api.public<SignInResponse>('POST', '/auth/login', { email, password }).pipe(map((res) => this.signedIn(res, true)));
  }

  logout(): Observable<void> {
    return this.api.public<void>('POST', '/auth/logout').pipe(
      catchError(() => of(undefined)), // signing out locally must always work
      tap(() => this.signedOut()),
      map(() => undefined),
    );
  }

  verifyEmail(token: string): Observable<void> {
    return this.api.public<void>('POST', '/auth/verify-email', { token });
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.api.public<void>('POST', '/auth/password-reset/request', { email });
  }

  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.api.public<void>('POST', '/auth/password-reset', { token, password: newPassword });
  }

  updateProfile(changes: { name: string; phone?: string }): Observable<User> {
    return this.api.authed<User>('PATCH', '/account/profile', changes).pipe(
      tap((user) => {
        const current = this.mockUsers.session();
        if (current) this.mockUsers.mirrorSession({ ...current, user });
      }),
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.api.authed<void>('POST', '/auth/change-password', { currentPassword, newPassword });
  }

  exportData(): Observable<AccountExport> {
    return this.api.authed<AccountExport>('GET', '/account/export');
  }

  deleteAccount(password: string): Observable<void> {
    return this.api.authed<void>('POST', '/account/delete', { password }).pipe(tap(() => this.signedOut()));
  }
}

/** `AddressBookApi` against the real backend: every call returns the full, freshly ordered list. */
@Injectable()
export class HttpAddressBookApi extends AddressBookApi {
  private readonly api = inject(ApiClient);

  list(): Observable<SavedAddress[]> {
    return this.api.authed('GET', '/account/addresses');
  }

  add(input: AddressInput): Observable<SavedAddress[]> {
    return this.api.authed('POST', '/account/addresses', input);
  }

  update(id: string, input: AddressInput): Observable<SavedAddress[]> {
    return this.api.authed('PUT', `/account/addresses/${encodeURIComponent(id)}`, input);
  }

  remove(id: string): Observable<SavedAddress[]> {
    return this.api.authed('DELETE', `/account/addresses/${encodeURIComponent(id)}`);
  }

  setDefault(id: string): Observable<SavedAddress[]> {
    return this.api.authed('POST', `/account/addresses/${encodeURIComponent(id)}/default`);
  }
}
