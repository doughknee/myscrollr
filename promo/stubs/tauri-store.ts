/**
 * Stand-in for @tauri-apps/plugin-store.
 *
 * The chips don't touch persistent storage, but they import
 * `shouldShowOnTicker` from preferences.ts, and preferences.ts imports
 * lib/store.ts, which constructs a LazyStore at module scope. That
 * import chain has to resolve for the bundle to build even though
 * nothing in a render path ever calls it.
 *
 * Installing a Tauri package into a video project to satisfy an import
 * that never runs would be worse, so remotion.config.ts aliases the
 * module here instead.
 *
 * Every method throws rather than returning a plausible empty value. If
 * a component ever DOES reach for storage during a render, that's a
 * real bug — the composition would be silently rendering default
 * preferences instead of the ones the shot intends — and a loud failure
 * is how we find out.
 */

const unreachable = (method: string): never => {
  throw new Error(
    `[promo] LazyStore.${method}() was called during a render. ` +
      `Compositions must pass preferences explicitly as props — see ` +
      `promo/stubs/tauri-store.ts.`,
  );
};

export class LazyStore {
  constructor(_path: string) {
    // Constructing is fine and expected: lib/store.ts does it at module
    // scope. Only actual operations are a problem.
  }

  async get<T>(_key: string): Promise<T | null> {
    return unreachable("get");
  }
  async set(_key: string, _value: unknown): Promise<void> {
    return unreachable("set");
  }
  async entries<T>(): Promise<[string, T][]> {
    return unreachable("entries");
  }
  async save(): Promise<void> {
    return unreachable("save");
  }
  async delete(_key: string): Promise<boolean> {
    return unreachable("delete");
  }
  /*
    The SUBSCRIPTIONS do not throw, unlike everything above, and the
    distinction is deliberate.
   
    Reading storage and getting a plausible empty value is dangerous —
    the composition would render default preferences while looking like
    it rendered the shot's. Subscribing to changes that will never come
    is not: a render is one frame of a fixed timeline, nothing mutates
    during it, and "you will never be notified" is the truthful answer.
   
    ScrollrTicker subscribes on mount (watchlist), so throwing here took
    the whole ticker down.
  */
  async onChange<T>(
    _cb: (key: string, value: T | null) => void,
  ): Promise<UnlistenFn> {
    return () => {};
  }
  async onKeyChange<T>(
    _key: string,
    _cb: (value: T | null) => void,
  ): Promise<UnlistenFn> {
    return () => {};
  }
}

type UnlistenFn = () => void;
