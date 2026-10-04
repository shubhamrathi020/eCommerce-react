/**
 * A small reactive core with the same shape as Angular signals (`signal`, `computed`, `effect`, `untracked`), so the
 * services and stores written against signals run unchanged outside Angular. React components subscribe to any signal
 * through `useSignal` (see ./react.ts).
 *
 * Reads inside a `computed` or `effect` are tracked; when a dependency changes the computed is invalidated and its own
 * subscribers are told, and the effect is queued to run again.
 */
type Listener = () => void;

let tracker: Set<ReactiveNode> | null = null;

abstract class ReactiveNode {
  readonly listeners = new Set<Listener>();
  protected notify(): void {
    for (const l of [...this.listeners]) l();
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface Signal<T> {
  (): T;
  /** @internal used by `useSignal` */
  readonly node: ReactiveNode;
}

export interface WritableSignal<T> extends Signal<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
  asReadonly(): Signal<T>;
}

class WritableNode<T> extends ReactiveNode {
  constructor(
    private value: T,
    private readonly equal: (a: T, b: T) => boolean,
  ) {
    super();
  }
  get(): T {
    tracker?.add(this);
    return this.value;
  }
  peek(): T {
    return this.value;
  }
  set(next: T): void {
    if (this.equal(this.value, next)) return;
    this.value = next;
    this.notify();
  }
}

class ComputedNode<T> extends ReactiveNode {
  private value!: T;
  private dirty = true;
  private unsubscribes: Listener[] = [];
  constructor(private readonly fn: () => T) {
    super();
  }
  private readonly invalidate = () => {
    if (!this.dirty) {
      this.dirty = true;
      this.notify();
    }
  };
  get(): T {
    tracker?.add(this);
    if (this.dirty) this.recompute();
    return this.value;
  }
  private recompute(): void {
    for (const u of this.unsubscribes) u();
    const deps = new Set<ReactiveNode>();
    const outer = tracker;
    tracker = deps;
    try {
      this.value = this.fn();
    } finally {
      tracker = outer;
    }
    this.unsubscribes = [...deps].map((d) => d.subscribe(this.invalidate));
    this.dirty = false;
  }
}

function make<T>(node: { get(): T } & ReactiveNode, extra: object = {}): Signal<T> {
  const fn = (() => node.get()) as Signal<T>;
  Object.defineProperty(fn, 'node', { value: node });
  return Object.assign(fn, extra);
}

export function signal<T>(initial: T, options?: { equal?: (a: T, b: T) => boolean }): WritableSignal<T> {
  const node = new WritableNode<T>(initial, options?.equal ?? Object.is);
  const s = make(node, {
    set: (v: T) => node.set(v),
    update: (f: (v: T) => T) => node.set(f(node.peek())),
  }) as WritableSignal<T>;
  s.asReadonly = () => make(node);
  return s;
}

export function computed<T>(fn: () => T): Signal<T> {
  return make(new ComputedNode(fn));
}

export function untracked<T>(fn: () => T): T {
  const outer = tracker;
  tracker = null;
  try {
    return fn();
  } finally {
    tracker = outer;
  }
}

export interface EffectRef {
  destroy(): void;
}

/** Runs `fn` now and again (on a microtask) whenever a signal it read changes. */
export function effect(fn: () => void): EffectRef {
  let unsubscribes: Listener[] = [];
  let queued = false;
  let destroyed = false;
  const run = () => {
    queued = false;
    if (destroyed) return;
    for (const u of unsubscribes) u();
    const deps = new Set<ReactiveNode>();
    const outer = tracker;
    tracker = deps;
    try {
      fn();
    } finally {
      tracker = outer;
    }
    unsubscribes = [...deps].map((d) =>
      d.subscribe(() => {
        if (!queued) {
          queued = true;
          queueMicrotask(run);
        }
      }),
    );
  };
  run();
  return {
    destroy() {
      destroyed = true;
      for (const u of unsubscribes) u();
    },
  };
}

/** Subscribes to a signal for changes (used by the React hook). */
export function subscribeTo(s: Signal<unknown>, listener: Listener): () => void {
  // Make sure a computed has evaluated at least once, so it is wired to its own dependencies.
  untracked(() => s());
  return s.node.subscribe(listener);
}
