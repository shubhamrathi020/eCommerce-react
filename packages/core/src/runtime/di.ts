/**
 * A small dependency-injection container with the same surface the Angular code uses (`Injectable`, `inject`,
 * `InjectionToken`, providers with `useClass` / `useValue` / `useFactory` / `useExisting`), so services written for Angular
 * run unchanged. A class marked `@Injectable({ providedIn: 'root' })` is created on first use; an abstract class (an API
 * contract) must be provided explicitly, exactly as in Angular.
 */
export type Ctor<T = any> = abstract new (...args: any[]) => T;

export class InjectionToken<T> {
  readonly desc: string;
  readonly providedIn?: 'root';
  readonly factory?: () => T;
  constructor(desc: string, options?: { providedIn?: 'root'; factory: () => T }) {
    this.desc = desc;
    this.providedIn = options?.providedIn;
    this.factory = options?.factory;
  }
  toString(): string {
    return `InjectionToken ${this.desc}`;
  }
}

export type Token<T = unknown> = Ctor<T> | InjectionToken<T>;

export type Provider =
  | { provide: Token; useClass: Ctor }
  | { provide: Token; useValue: unknown }
  | { provide: Token; useFactory: () => unknown }
  | { provide: Token; useExisting: Token }
  | Ctor;

const rootProvided = new WeakSet<object>();

/** Class decorator. `providedIn: 'root'` lets the class be created on first use without being provided. */
export function Injectable(options?: { providedIn?: 'root' }): (target: Ctor, context?: unknown) => void {
  return (target) => {
    if (options?.providedIn === 'root') rootProvided.add(target);
  };
}

let current: Injector | null = null;

const NONE = Symbol('none');

function describe(token: Token): string {
  return token instanceof InjectionToken ? token.toString() : ((token as { name?: string }).name ?? 'a token');
}

export class Injector {
  private readonly providers = new Map<Token, Provider>();
  private readonly instances = new Map<Token, unknown>();
  private readonly resolving = new Set<Token>();

  constructor(
    providers: Provider[] = [],
    private readonly parent?: Injector,
  ) {
    for (const p of providers) this.provide(p);
  }

  provide(p: Provider): void {
    const token = typeof p === 'function' ? p : p.provide;
    this.providers.set(token, p);
    this.instances.delete(token);
  }

  has(token: Token): boolean {
    return this.providers.has(token) || !!this.parent?.has(token);
  }

  get<T>(token: Token<T>, options?: { optional?: boolean }): T {
    if (this.instances.has(token)) return this.instances.get(token) as T;
    const provider = this.providers.get(token);
    if (provider === undefined && this.parent?.has(token)) return this.parent.get(token, options);
    if (this.resolving.has(token)) throw new Error(`Circular dependency while creating ${describe(token)}`);
    this.resolving.add(token);
    try {
      const instance = this.create(token, provider, options);
      if (instance === NONE) return null as T;
      this.instances.set(token, instance);
      return instance as T;
    } finally {
      this.resolving.delete(token);
    }
  }

  private create(token: Token, provider: Provider | undefined, options?: { optional?: boolean }): unknown {
    return this.run(() => {
      if (provider !== undefined) {
        if (typeof provider === 'function') return new (provider as unknown as new () => unknown)();
        if ('useValue' in provider) return provider.useValue;
        if ('useFactory' in provider) return provider.useFactory();
        if ('useExisting' in provider) return this.get(provider.useExisting);
        return new (provider.useClass as unknown as new () => unknown)();
      }
      if (token instanceof InjectionToken && token.factory) return token.factory();
      if (typeof token === 'function' && rootProvided.has(token)) return new (token as unknown as new () => unknown)();
      if (options?.optional) return NONE;
      throw new Error(`No provider for ${describe(token)}`);
    });
  }

  /** Runs `fn` so that `inject()` calls inside it resolve from this injector. */
  run<T>(fn: () => T): T {
    const outer = current;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    try {
      return fn();
    } finally {
      current = outer;
    }
  }
}

let root = new Injector();

/** The application injector, used by `inject()` outside any construction context. */
export function rootInjector(): Injector {
  return root;
}

/** Replaces the application injector (app start-up and tests). */
export function setRootInjector(injector: Injector): void {
  root = injector;
}

export function inject<T>(token: Token<T>, options: { optional: true }): T | null;
export function inject<T>(token: Token<T>, options?: { optional?: boolean }): T;
export function inject<T>(token: Token<T>, options?: { optional?: boolean }): T | null {
  return (current ?? root).get(token, options);
}

/** A bundle of providers plus start-up work, the counterpart of Angular's EnvironmentProviders. */
export interface EnvironmentProviders {
  providers: Provider[];
  initializers: Array<() => void>;
}

function isBundle(p: Provider | EnvironmentProviders): p is EnvironmentProviders {
  return typeof p === 'object' && p !== null && 'initializers' in p;
}

/** Flattens providers and bundles into one bundle. */
export function makeEnvironmentProviders(list: Array<Provider | EnvironmentProviders>): EnvironmentProviders {
  const out: EnvironmentProviders = { providers: [], initializers: [] };
  for (const item of list) {
    if (isBundle(item)) {
      out.providers.push(...item.providers);
      out.initializers.push(...item.initializers);
    } else out.providers.push(item);
  }
  return out;
}

/** Work to run once when the injector is created (inside it, so `inject()` works). */
export function provideEnvironmentInitializer(fn: () => void): EnvironmentProviders {
  return { providers: [], initializers: [fn] };
}

/** Creates an injector from providers and runs their initializers. */
export function createInjector(list: Array<Provider | EnvironmentProviders>, parent?: Injector): Injector {
  const bundle = makeEnvironmentProviders(list);
  const injector = new Injector(bundle.providers, parent);
  injector.run(() => bundle.initializers.forEach((init) => init()));
  return injector;
}
