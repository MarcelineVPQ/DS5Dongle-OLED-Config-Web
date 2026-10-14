// One tiny external store (a value, its listeners and a React hook) for
// module-level state any part of the app can change: the shown-error notice
// (shownError.ts), the toast queue (toast.ts) and the dismissed notices
// (notices.ts). Components read it with `use()` (useSyncExternalStore).
import { useSyncExternalStore } from "react";

export interface ExternalStore<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
  use: () => T;
}

export function externalStore<T>(initial: T): ExternalStore<T> {
  // cache: OK — key=none (the store's one value); invalidated=each set; bound=1 value
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;
  const subscribe = (listener: () => void) => {
    // lifetime: OK — removed by the returned unsubscribe (useSyncExternalStore calls it on unmount)
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    get,
    set: (next) => {
      value = next;
      // loop: NOT-WORTH — a few listeners (the components showing it), per change
      for (const l of listeners) l();
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get),
  };
}
