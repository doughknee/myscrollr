/**
 * Persistent store backed by @tauri-apps/plugin-store.
 *
 * Replaces localStorage with a write-through in-memory cache so all
 * existing synchronous read patterns continue to work unchanged.
 *
 * Both windows (ticker + main) call `initStore()` once on startup.
 * After that:
 *   - `getStore()` reads synchronously from the in-memory Map.
 *   - `setStore()` updates the Map immediately, then writes to disk
 *     asynchronously (fire-and-forget).
 *   - `onStoreChange()` listens for changes from the *other* window
 *     via the plugin's built-in cross-webview broadcast. An equality
 *     guard prevents the writing window from re-triggering its own
 *     callback, avoiding infinite loops.
 *
 * On first run after the migration, `initStore()` automatically reads
 * any existing `scrollr:*` keys from localStorage, writes them to the
 * Tauri store, and clears the old keys.
 */
import { LazyStore } from "@tauri-apps/plugin-store";

// ── Singleton store instance ────────────────────────────────────

const store = new LazyStore("scrollr.json");
const cache = new Map<string, unknown>();
let initialized = false;

// ── Initialization ──────────────────────────────────────────────

/**
 * Load all entries from disk into the in-memory cache, then run
 * the one-time localStorage migration if needed. Must be awaited
 * before the React tree renders.
 */
export async function initStore(): Promise<void> {
  if (initialized) return;

  // Load existing store entries into the cache
  const entries = await store.entries<unknown>();
  for (const [key, value] of entries) {
    cache.set(key, value);
  }

  // One-time migration from localStorage
  if (!cache.has("scrollr:store-migrated")) {
    migrateFromLocalStorage();
    await store.save();
  }

  initialized = true;
}

// ── Read / Write / Remove ───────────────────────────────────────

/** Synchronous read from the in-memory cache. */
export function getStore<T>(key: string, fallback: T): T {
  const value = cache.get(key);
  return value !== undefined ? (value as T) : fallback;
}

/** Update the cache immediately, then persist to disk async. */
export function setStore<T>(key: string, value: T): void {
  cache.set(key, value);
  store.set(key, value as unknown).catch(logWriteError);
}

/**
 * Update the cache, write to disk, AND wait for the on-disk save to
 * complete before resolving. Use this for data where loss across a
 * process exit is unacceptable — most importantly auth state.
 *
 * Why this exists: Tauri's LazyStore.set() doesn't immediately fsync;
 * it batches writes via an internal autoSave debounce (~100ms). If the
 * process exits, the laptop sleeps, or the OS terminates the app
 * inside that window, the disk has the previous (stale) value while
 * the in-memory cache had the new one. On next launch we read the
 * stale value from disk and use it.
 *
 * For auth state, that pattern manifests as: refresh succeeds, Logto
 * rotates R0 → R1 server-side, we get R1 in memory, app suspends
 * before disk write, next launch reads R0 from disk, sends R0 to
 * Logto, Logto detects refresh-token reuse → invalidates the entire
 * token family → 400 → user logged out.
 *
 * setStorePersisted closes that window by awaiting both the set and
 * the explicit save. Slower than setStore (one extra disk-flush round
 * trip per call) — only use it where loss is genuinely unacceptable.
 */
export async function setStorePersisted<T>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  await store.set(key, value as unknown);
  await store.save();
}

/** Remove a key from both cache and disk. */
export function removeStore(key: string): void {
  cache.delete(key);
  store.delete(key).catch(logWriteError);
}

/**
 * Remove a key from cache + disk and wait for both to complete.
 * Same rationale as setStorePersisted — use for auth-state clears
 * where leaving stale data on disk is unacceptable.
 */
export async function removeStorePersisted(key: string): Promise<void> {
  cache.delete(key);
  await store.delete(key);
  await store.save();
}

function logWriteError(err: unknown): void {
  console.error("[Scrollr] Store write failed:", err);
}

// ── Cross-window change listener ────────────────────────────────

/**
 * Subscribe to changes for a specific key. The callback fires only
 * when the value actually differs from the local cache (i.e. when
 * the *other* window wrote a new value). Returns an unsubscribe fn.
 */
export function onStoreChange<T>(
  key: string,
  callback: (newValue: T) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let disposed = false;

  store.onKeyChange<T>(key, (newValue) => {
    if (disposed) return;

    // Equality guard: skip if the value matches what we already have.
    // This prevents the window that wrote the value from re-triggering
    // its own handler and avoids infinite update loops.
    const current = cache.get(key);
    if (stableStringify(current) === stableStringify(newValue)) return;

    cache.set(key, newValue);
    callback(newValue as T);
  }).then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}

// ── localStorage migration ──────────────────────────────────────

function migrateFromLocalStorage(): void {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("scrollr:")) continue;

    // Skip if the store already has this key (shouldn't happen on
    // first migration, but guards against double-run).
    if (cache.has(key)) {
      keysToRemove.push(key);
      continue;
    }

    const raw = localStorage.getItem(key);
    if (raw === null) continue;

    // Try to parse as JSON; fall back to raw string for bare values
    // like scrollr:widget:weather:unit which stores "celsius" without
    // JSON.stringify wrapping.
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }

    cache.set(key, value);
    store.set(key, value);
    keysToRemove.push(key);
  }

  // Clear migrated keys from localStorage
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  // Mark migration as complete
  cache.set("scrollr:store-migrated", true);
  store.set("scrollr:store-migrated", true);
}

// ── Utilities ───────────────────────────────────────────────────

/** Deterministic JSON serialization for equality comparison.
 *  Recursively sorts object keys so that two semantically-identical objects
 *  produced by different code paths (e.g. different preference init orders)
 *  compare equal. Arrays preserve order. Primitives and cyclic refs fall
 *  back to `String(value)`.
 *
 *  Exported solely so the unit-test suite can lock down this behavior. The
 *  runtime only uses it internally from `onStoreChange` — do not take a new
 *  dependency on this helper from feature code. */
export function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
        return sorted;
      }
      return val;
    });
  } catch {
    return String(value);
  }
}
