import { Injectable, computed, inject, signal } from '@shop/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { AuthApi } from '@shop/data-access';
import type { RegisterRequest, Session } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { CartStore } from './cart.store';
import { NotificationStore } from './notification.store';

export interface AuthResult<T = void> {
  ok: boolean;
  data?: T;
  /** User-readable failure message. */
  message?: string;
  /** Field-level messages from validation. */
  fields?: Record<string, string>;
}

/** App-wide identity state. Holds only the session snapshot (no password, hash or token). */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApi);
  private readonly cart = inject(CartStore);
  private readonly notifications = inject(NotificationStore);
  private readonly browser = typeof window !== 'undefined';

  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);
  private readonly _busy = signal(false);
  private initPromise?: Promise<void>;

  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  readonly loggedIn = computed(() => this._session() !== null);
  /** False until the first session lookup finished. */
  readonly ready = this._ready.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly permissions = computed(() => this._session()?.user.permissions ?? []);

  constructor() {
    if (this.browser) void this.init();
  }

  /** Resolves once the session has been looked up (guards await this). */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      try {
        this._session.set(await firstValueFrom(this.api.me()));
      } catch {
        this._session.set(null);
      }
      await this.notifications.refresh(this.loggedIn());
      this._ready.set(true);
    })();
    return this.initPromise;
  }

  hasPermission(permission: string): boolean {
    return this.permissions().includes(permission);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const result = await this.run(this.api.login(email, password));
    if (result.ok) await this.afterSessionChange();
    return result.ok ? { ok: true } : result;
  }

  async register(request: RegisterRequest): Promise<AuthResult> {
    const result = await this.run(this.api.register(request));
    if (result.ok) await this.afterSessionChange();
    return result.ok ? { ok: true } : result;
  }

  async logout(): Promise<void> {
    await this.run(this.api.logout());
    this._session.set(null);
    await this.afterSessionChange();
  }

  /** Re-reads the session after the server changed it (profile edit, email verified). */
  async refresh(): Promise<void> {
    this._session.set(await firstValueFrom(this.api.me()));
  }

  private async afterSessionChange(): Promise<void> {
    // The cart belongs to whoever is signed in (guest carts are merged on sign in).
    await this.cart.refresh();
    await this.notifications.refresh(this.loggedIn());
  }

  private async run(request: Observable<Session | void>): Promise<AuthResult> {
    this._busy.set(true);
    try {
      const value = await firstValueFrom(request);
      if (value) this._session.set(value);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiException) return { ok: false, message: error.message, ...(error.fields ? { fields: error.fields } : {}) };
      return { ok: false, message: 'Something went wrong. Please try again.' };
    } finally {
      this._busy.set(false);
    }
  }
}
