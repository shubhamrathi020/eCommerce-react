import { provideHttpClient } from '@shop/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@shop/core/testing';
import { TestBed } from '@shop/core/testing';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '@shop/core';
import type { Session } from '@ecom/contracts';
import { ApiException } from '@ecom/contracts';
import { AddressBookApi, AuthApi, provideDataAccess } from '../index';
import { MockUserStore } from '../mock/mock-user-store';

const BASE = 'http://api.test';
const session: Session = { user: { id: 'u1', name: 'Asha', email: 'asha@example.com', roles: ['customer'], permissions: ['address:write:own'], emailVerified: true, createdAt: '2026-09-01T00:00:00.000Z' }, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString() };

describe('HTTP adapters for the real API (realAuth)', () => {
  let http: HttpTestingController;
  let auth: AuthApi;
  let addresses: AddressBookApi;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { useMocks: true, realAuth: true, apiBaseUrl: `${BASE}/`, siteName: 'S', siteUrl: 'http://x', features: {} } },
        provideDataAccess({ useMocks: true, realAuth: true }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthApi);
    addresses = TestBed.inject(AddressBookApi);
  });
  afterEach(() => http.verify());

  it('signs in with credentials included, keeps the access token in memory only, and mirrors the session for the mocks', async () => {
    const result = firstValueFrom(auth.login('asha@example.com', 'Str0ngPass'));
    const req = http.expectOne(`${BASE}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body).toEqual({ email: 'asha@example.com', password: 'Str0ngPass' });
    expect(req.request.headers.get('x-request-id')).toBeTruthy();
    req.flush({ session, accessToken: 'access-1' });
    expect(await result).toEqual(session);
    expect(JSON.stringify(localStorage)).not.toContain('access-1');
    expect(TestBed.inject(MockUserStore).currentUserId()).toBe('u1');

    const list = firstValueFrom(addresses.list());
    const listReq = http.expectOne(`${BASE}/account/addresses`);
    expect(listReq.request.headers.get('authorization')).toBe('Bearer access-1');
    listReq.flush([]);
    expect(await list).toEqual([]);
  });

  it('restores a session on page load through the refresh cookie (with the CSRF header), or reports none', async () => {
    const restored = firstValueFrom(auth.me());
    const req = http.expectOne(`${BASE}/auth/refresh`);
    expect(req.request.headers.get('x-csrf')).toBe('1');
    req.flush({ session, accessToken: 'access-2' });
    expect(await restored).toEqual(session);

    const none = firstValueFrom(auth.me());
    http.expectOne(`${BASE}/auth/refresh`).flush({ code: 'unauthorized', message: 'Please sign in.' }, { status: 401, statusText: 'Unauthorized' });
    expect(await none).toBeNull();
    expect(TestBed.inject(MockUserStore).currentUserId()).toBeNull();
  });

  it('refreshes an expired access token once and retries the original request', async () => {
    const login = firstValueFrom(auth.login('asha@example.com', 'Str0ngPass'));
    http.expectOne(`${BASE}/auth/login`).flush({ session, accessToken: 'old' });
    await login;

    const list = firstValueFrom(addresses.list());
    const tick = () => new Promise((r) => setTimeout(r, 0));
    http.expectOne(`${BASE}/account/addresses`).flush({ code: 'unauthorized', message: 'Your session has expired. Please sign in again.' }, { status: 401, statusText: 'Unauthorized' });
    await tick();
    http.expectOne(`${BASE}/auth/refresh`).flush({ session, accessToken: 'new' });
    await tick();
    const retry = http.expectOne(`${BASE}/account/addresses`);
    expect(retry.request.headers.get('authorization')).toBe('Bearer new');
    retry.flush([{ id: 'a1', label: 'Home', name: 'Asha', phone: '9876543210', address: { line1: '1', city: 'B', state: 'K', pincode: '560001' }, isDefault: true }]);
    expect((await list)[0].id).toBe('a1');
  });

  it('turns API errors into the same ApiException the pages already handle, and network failures into "network"', async () => {
    const bad = firstValueFrom(auth.register({ name: '', email: 'x', password: 'y' }));
    http.expectOne(`${BASE}/auth/register`).flush({ code: 'validation', message: 'Please check the highlighted fields.', fields: { name: 'Name is required' }, requestId: 'r-1' }, { status: 400, statusText: 'Bad Request' });
    const error = await bad.catch((e) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({ code: 'validation', fields: { name: 'Name is required' }, requestId: 'r-1' });

    const offline = firstValueFrom(auth.requestPasswordReset('a@b.co'));
    http.expectOne(`${BASE}/auth/password-reset/request`).error(new ProgressEvent('error'));
    expect(await offline.catch((e) => e)).toMatchObject({ code: 'network' });
  });

  it('logs out locally even if the server cannot be reached', async () => {
    const out = firstValueFrom(auth.logout(), { defaultValue: undefined });
    http.expectOne(`${BASE}/auth/logout`).error(new ProgressEvent('error'));
    await out;
    expect(TestBed.inject(MockUserStore).currentUserId()).toBeNull();
  });
});
