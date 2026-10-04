import { APP_CONFIG, Injectable, inject } from '@shop/core';
import type { ApiError, ApiErrorCode } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { type Observable, catchError, defer, finalize, from, shareReplay, switchMap, throwError } from 'rxjs';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const CODES: ApiErrorCode[] = ['not_found', 'validation', 'unauthorized', 'forbidden', 'conflict', 'network', 'unknown'];

/** A response that was not a success, or no response at all (`status` 0). */
export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpFailure';
  }
}

/** Rebuilds the backend's `{ code, message, fields?, requestId? }` body as the `ApiException` every page already handles. */
export function toApiException(error: unknown): ApiException {
  if (error instanceof ApiException) return error;
  if (error instanceof HttpFailure) {
    if (error.status === 0) return new ApiException('network', 'We could not reach the server. Check your connection and try again.');
    const body = error.body as Partial<ApiError> | null;
    const code = body?.code && CODES.includes(body.code) ? body.code : error.status >= 500 ? 'unknown' : 'validation';
    return new ApiException(code, body?.message ?? 'Something went wrong. Please try again.', body?.fields, body?.requestId);
  }
  return new ApiException('unknown', 'Something went wrong. Please try again.');
}

const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The single HTTP entry point for the real-API adapters (Nest or Go; they speak the same API). The short-lived access token
 * lives only here, in memory (never in storage); the refresh token is an HttpOnly cookie the browser handles. A request
 * rejected as `unauthorized` gets one transparent refresh-and-retry; concurrent requests share that single refresh.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly base = inject(APP_CONFIG).apiBaseUrl.replace(/\/$/, '');
  private accessToken: string | null = null;
  private refreshing: Observable<string> | null = null;

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  /** Calls an endpoint that needs no access token (sign in, register, refresh, reset ...). */
  public<T>(method: Method, path: string, body?: unknown): Observable<T> {
    return this.send<T>(method, path, body, false).pipe(catchError((e) => throwError(() => toApiException(e))));
  }

  /** Calls an endpoint that works whether or not the caller is signed in (cart, checkout, orders, payments): attaches the
   * access token when we have one, so a signed-in user's cart/orders are recognised as theirs, but never tries to refresh
   * on a 401 — these endpoints don't require auth at all, so they never reply 401 just because the token is stale. */
  optional<T>(method: Method, path: string, body?: unknown): Observable<T> {
    return this.send<T>(method, path, body, true).pipe(catchError((e) => throwError(() => toApiException(e))));
  }

  /** Calls an endpoint as the signed-in user, refreshing the access token once if it has expired. */
  authed<T>(method: Method, path: string, body?: unknown): Observable<T> {
    return defer(() => this.send<T>(method, path, body, true)).pipe(
      catchError((error: unknown) => {
        const e = toApiException(error);
        if (e.code !== 'unauthorized') return throwError(() => e);
        return this.refreshToken().pipe(
          switchMap(() => this.send<T>(method, path, body, true)),
          catchError((retry) => throwError(() => toApiException(retry))),
        );
      }),
    );
  }

  /** Registered by the auth adapter: exchanges the refresh cookie for a new access token. */
  refreshWith(refresh: () => Promise<string>): void {
    this.doRefresh = refresh;
  }

  private doRefresh: () => Promise<string> = () => Promise.reject(new ApiException('unauthorized', 'Please sign in.'));

  private refreshToken(): Observable<string> {
    this.refreshing ??= defer(() => from(this.doRefresh())).pipe(
      finalize(() => (this.refreshing = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshing;
  }

  private send<T>(method: Method, path: string, body: unknown, withToken: boolean): Observable<T> {
    const headers: Record<string, string> = { 'x-request-id': newRequestId() };
    // Custom header the API requires on every mutating call that can run off a cookie, not just a bearer token (CSRF
    // protection, see the API's CsrfGuard): /auth's cookie-authenticated endpoints, and the cart/order/payment endpoints,
    // which the guest cart cookie makes reachable without one.
    if (method !== 'GET' && (path.startsWith('/auth/') || path.startsWith('/cart') || path.startsWith('/orders'))) headers['x-csrf'] = '1';
    if (withToken && this.accessToken) headers['authorization'] = `Bearer ${this.accessToken}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const init: RequestInit = { method, headers, credentials: 'include', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
    return defer(() => from(this.request<T>(`${this.base}${path}`, init)));
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new HttpFailure(0, null);
    }
    const text = res.status === 204 ? '' : await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new HttpFailure(res.status, parsed);
    return parsed as T;
  }
}
