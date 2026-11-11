// A minimal observable value. React reads it through useStore (ui/hooks.ts, useSyncExternalStore),
// so a component re-renders only when the slice it selects changes.
export class Store<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();
  constructor(initial: T) {
    this.value = initial;
  }
  get(): T {
    return this.value;
  }
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const fn of [...this.listeners]) fn();
  }
  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

/** A version counter for state held elsewhere (edit logs, the library): bump() notifies. */
export class Signal extends Store<number> {
  constructor() {
    super(0);
  }
  bump(): void {
    this.set(this.get() + 1);
  }
}
