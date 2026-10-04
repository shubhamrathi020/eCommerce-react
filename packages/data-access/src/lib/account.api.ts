import type { Observable } from 'rxjs';
import type { AccountExport, RegisterRequest, SavedAddress, Session, User } from '@ecom/contracts';
import type { Address } from '@ecom/contracts';

/**
 * Identity contract. The real backend keeps the session in an HttpOnly cookie; the client only ever
 * sees a `Session` snapshot (never a password, hash or token). Errors are `ApiException`s.
 */
export abstract class AuthApi {
  /** The current session, or null when signed out. */
  abstract me(): Observable<Session | null>;
  abstract register(request: RegisterRequest): Observable<Session>;
  /** Fails with one generic message for any wrong credential; `forbidden` while locked out. */
  abstract login(email: string, password: string): Observable<Session>;
  abstract logout(): Observable<void>;
  abstract verifyEmail(token: string): Observable<void>;
  /** Always succeeds, so callers cannot tell whether an account exists. */
  abstract requestPasswordReset(email: string): Observable<void>;
  abstract resetPassword(token: string, newPassword: string): Observable<void>;
  abstract updateProfile(changes: { name: string; phone?: string }): Observable<User>;
  abstract changePassword(currentPassword: string, newPassword: string): Observable<void>;
  abstract exportData(): Observable<AccountExport>;
  abstract deleteAccount(password: string): Observable<void>;
}

export interface AddressInput {
  label: string;
  name: string;
  phone: string;
  address: Address;
}

/** The signed-in customer's saved delivery addresses. Fails with `unauthorized` when signed out. */
export abstract class AddressBookApi {
  abstract list(): Observable<SavedAddress[]>;
  abstract add(input: AddressInput): Observable<SavedAddress[]>;
  abstract update(id: string, input: AddressInput): Observable<SavedAddress[]>;
  abstract remove(id: string): Observable<SavedAddress[]>;
  abstract setDefault(id: string): Observable<SavedAddress[]>;
}
