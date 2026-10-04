import { describe, expect, it, vi } from 'vitest';
import { Injectable, InjectionToken, Injector, computed, effect, inject, signal, untracked } from './index';

describe('signals', () => {
  it('computed values follow their sources and only recompute when something they read changes', () => {
    const a = signal(2);
    const b = signal(3);
    const fn = vi.fn(() => a() * b());
    const product = computed(fn);
    expect(product()).toBe(6);
    expect(product()).toBe(6);
    expect(fn).toHaveBeenCalledTimes(1);
    a.set(5);
    expect(product()).toBe(15);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers of a computed only when it is invalidated', () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    const seen: number[] = [];
    const stop = doubled.node.subscribe(() => seen.push(doubled()));
    doubled(); // wire to its source
    count.set(2);
    count.set(3);
    expect(seen).toEqual([4, 6]);
    stop();
    count.set(4);
    expect(seen).toEqual([4, 6]);
  });

  it('does not notify when a signal is set to an equal value', () => {
    const s = signal('x');
    const listener = vi.fn();
    s.node.subscribe(listener);
    s.set('x');
    expect(listener).not.toHaveBeenCalled();
    s.update((v) => v + 'y');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('effects run now and again after a change, and stop when destroyed; untracked reads are not dependencies', async () => {
    const a = signal(1);
    const b = signal(10);
    const log: number[] = [];
    const ref = effect(() => log.push(a() + untracked(() => b())));
    expect(log).toEqual([11]);
    b.set(20);
    await Promise.resolve();
    expect(log).toEqual([11]);
    a.set(2);
    await Promise.resolve();
    expect(log).toEqual([11, 22]);
    ref.destroy();
    a.set(3);
    await Promise.resolve();
    expect(log).toEqual([11, 22]);
  });
});

describe('dependency injection', () => {
  abstract class Greeter {
    abstract hello(): string;
  }
  @Injectable({ providedIn: 'root' })
  class Counter {
    n = 0;
  }
  @Injectable({ providedIn: 'root' })
  class Needs {
    readonly counter = inject(Counter);
    readonly greeter = inject(Greeter);
  }
  const TOKEN = new InjectionToken<number>('TOKEN', { providedIn: 'root', factory: () => 42 });

  it('creates root services once, resolves abstract classes from providers, and supports token factories', () => {
    const injector = new Injector([{ provide: Greeter, useValue: { hello: () => 'hi' } }]);
    const needs = injector.get(Needs);
    expect(needs.greeter.hello()).toBe('hi');
    expect(injector.get(Needs)).toBe(needs);
    expect(needs.counter).toBe(injector.get(Counter));
    expect(injector.get(TOKEN)).toBe(42);
  });

  it('refuses an unprovided abstract class, returns null for an optional one, and swaps implementations with useClass', () => {
    const injector = new Injector();
    expect(() => injector.get(Greeter)).toThrow(/No provider for Greeter/);
    expect(injector.get(Greeter, { optional: true })).toBeNull();
    class Loud extends Greeter {
      hello() {
        return 'HI';
      }
    }
    expect(new Injector([{ provide: Greeter, useClass: Loud }]).get(Greeter).hello()).toBe('HI');
  });

  it('detects a circular dependency instead of overflowing the stack', () => {
    @Injectable({ providedIn: 'root' })
    class A {
      b = inject(B);
    }
    @Injectable({ providedIn: 'root' })
    class B {
      a = inject(A);
    }
    expect(() => new Injector().get(A)).toThrow(/Circular/);
  });
});
