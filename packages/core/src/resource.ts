import { useCallback, useEffect, useRef, useState } from 'react';
import { type Observable, firstValueFrom, isObservable } from 'rxjs';

export type ResourceStatus = 'loading' | 'ready' | 'error';

export interface Resource<T> {
  /** `loading` until the first answer; `error` when the last load failed; otherwise `ready`. */
  status: ResourceStatus;
  /** The last successful value. It is kept while a reload is in flight, like Angular's rxResource. */
  value: T | undefined;
  error: unknown;
  /** True during the first load and during every reload. */
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data from an Observable (an API call) or a Promise whenever `deps` change, ignoring answers that arrive after a newer
 * request was started. Pass `null`-returning loaders through `enabled` to skip loading.
 */
export function useResource<T>(load: () => Observable<T> | Promise<T>, deps: readonly unknown[], enabled = true): Resource<T> {
  const [state, setState] = useState<{ status: ResourceStatus; value: T | undefined; error: unknown; loading: boolean }>({ status: 'loading', value: undefined, error: undefined, loading: enabled });
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    const source = loadRef.current();
    const promise = isObservable(source) ? firstValueFrom(source) : source;
    promise.then(
      (value) => {
        if (id === latest.current) setState({ status: 'ready', value, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (id === latest.current) setState((s) => ({ status: 'error', value: s.value, error, loading: false }));
      },
    );
    const counter = latest;
    return () => {
      // A newer request (or unmount) makes this answer irrelevant.
      if (counter.current === id) counter.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
