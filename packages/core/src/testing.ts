import { type EnvironmentProviders, Injectable, Injector, type Provider, type Token, createInjector, makeEnvironmentProviders, provideEnvironmentInitializer, setRootInjector } from './runtime';

/**
 * A stand-in for Angular's TestBed, so the shop's existing service tests run unchanged: configure providers, then resolve
 * services from a fresh injector. `resetTestingModule` starts over.
 */
class TestBedShim {
  private injector: Injector | null = null;

  configureTestingModule(config: { providers?: Array<Provider | EnvironmentProviders> } = {}): this {
    this.injector = createInjector(config.providers ?? []);
    setRootInjector(this.injector);
    return this;
  }

  inject<T>(token: Token<T>, options?: { optional?: boolean }): T {
    if (!this.injector) this.configureTestingModule();
    return (this.injector as Injector).get(token, options);
  }

  resetTestingModule(): void {
    this.injector = null;
    setRootInjector(new Injector());
    restoreFetch();
  }
}

export const TestBed = new TestBedShim();

/** Angular's zoneless change-detection provider; React has no equivalent, so this provides nothing. */
export function provideZonelessChangeDetection(): EnvironmentProviders {
  return makeEnvironmentProviders([]);
}

/** Angular's HTTP client needs no setup here (the shop uses `fetch`), so this provides nothing. */
export function provideHttpClient(): EnvironmentProviders {
  return makeEnvironmentProviders([]);
}

interface RecordedRequest {
  method: string;
  url: string;
  urlWithParams: string;
  body: unknown;
  withCredentials: boolean;
  headers: { get(name: string): string | null };
}

/** One request the code under test made; the test answers it with `flush` or `error`. */
export class TestRequest {
  readonly request: RecordedRequest;
  constructor(
    url: string,
    init: RequestInit,
    private readonly respond: (res: Response | Error) => void,
  ) {
    const raw = (init.headers ?? {}) as Record<string, string>;
    const lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
    this.request = {
      method: init.method ?? 'GET',
      url,
      urlWithParams: url,
      body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null,
      withCredentials: init.credentials === 'include',
      headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    };
  }
  flush(body: unknown, opts: { status?: number; statusText?: string } = {}): void {
    const status = opts.status ?? 200;
    const text = body === null || body === undefined || status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body);
    this.respond(new Response(text, { status, statusText: opts.statusText ?? '' }));
  }
  error(_event?: unknown): void {
    this.respond(new TypeError('Failed to fetch'));
  }
}

/** Records the requests made through `fetch` so a test can inspect and answer them (Angular's HttpTestingController). */
@Injectable()
export class HttpTestingController {
  private pending: TestRequest[] = [];

  /** @internal */
  add(r: TestRequest): void {
    this.pending.push(r);
  }

  expectOne(match: string | ((request: RecordedRequest) => boolean)): TestRequest {
    const hits = this.pending.filter((r) => (typeof match === 'string' ? r.request.url === match || r.request.urlWithParams === match : match(r.request)));
    if (hits.length !== 1) {
      const wanted = typeof match === 'string' ? match : 'the matching function';
      throw new Error(`Expected one matching request for ${wanted}, found ${hits.length}. Pending: ${this.pending.map((p) => `${p.request.method} ${p.request.url}`).join(', ') || 'none'}`);
    }
    this.pending.splice(this.pending.indexOf(hits[0]), 1);
    return hits[0];
  }

  verify(): void {
    if (this.pending.length) throw new Error(`Expected no open requests, found ${this.pending.length}: ${this.pending.map((p) => `${p.request.method} ${p.request.url}`).join(', ')}`);
  }
}

const realFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

/** Replaces `fetch` with a recorder for the lifetime of the testing module. */
export function provideHttpClientTesting(): EnvironmentProviders {
  const controller = new HttpTestingController();
  return makeEnvironmentProviders([
    { provide: HttpTestingController, useValue: controller },
    provideEnvironmentInitializer(() => {
      globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((resolve, reject) => {
          controller.add(new TestRequest(String(input), init, (res) => (res instanceof Error ? reject(res) : resolve(res))));
        })) as typeof fetch;
    }),
  ]);
}
