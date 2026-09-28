import { describe, it, expect, vi } from "vitest";

const keyListeners = vi.hoisted(() => new Map<string, ((v: unknown) => void)[]>());

// The store module imports @tauri-apps/plugin-store, which crashes outside a
// Tauri webview. Stub it out before loading the module under test.
vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    constructor(_file: string) {}
    async entries<T>(): Promise<[string, T][]> {
      return [];
    }
    async set(_k: string, _v: unknown): Promise<void> {}
    async delete(_k: string): Promise<boolean> {
      return true;
    }
    async save(): Promise<void> {}
    async onKeyChange<T>(k: string, cb: (v: T) => void): Promise<() => void> {
      keyListeners.set(k, [...(keyListeners.get(k) ?? []), cb as (v: unknown) => void]);
      return () => {};
    }
  }
  return { LazyStore };
});

import { getStore, onStoreChange, stableStringify } from "./store";

// ── onStoreChange fan-out (SCROLLR-248) ─────────────────────────

describe("onStoreChange", () => {
  it("fires every subscriber to a key, not just the first", () => {
    const a = vi.fn();
    const b = vi.fn();
    onStoreChange("k:fanout", a);
    const unsubB = onStoreChange("k:fanout", b);
    // Another window wrote the key: the plugin delivers it once per listener.
    for (const cb of keyListeners.get("k:fanout") ?? []) cb({ v: 1 });
    expect(a).toHaveBeenCalledWith({ v: 1 });
    expect(b).toHaveBeenCalledWith({ v: 1 });
    expect(getStore("k:fanout", null)).toEqual({ v: 1 });

    unsubB();
    for (const cb of keyListeners.get("k:fanout") ?? []) cb({ v: 2 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

// ── stableStringify ─────────────────────────────────────────────

describe("stableStringify", () => {
  it("produces identical output for objects with the same keys in different order", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, y: 2, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("recursively sorts nested object keys", () => {
    const a = { outer: { a: 1, b: 2 }, arr: [1, 2, 3] };
    const b = { arr: [1, 2, 3], outer: { b: 2, a: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array element order (does not sort arrays)", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  it("handles primitives", () => {
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(false)).toBe("false");
    expect(stableStringify(null)).toBe("null");
  });

  it("handles undefined without throwing", () => {
    // `JSON.stringify(undefined)` returns the value `undefined` (not a string),
    // and the stableStringify wrapper returns that directly. Consumers use the
    // return value only for equality comparison, so `undefined === undefined`
    // is still a correct answer.
    expect(() => stableStringify(undefined)).not.toThrow();
    expect(stableStringify(undefined)).toBe(stableStringify(undefined));
  });

  it("distinguishes different structural values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ b: 1 }));
  });

  it("matches two-levels-deep nested objects built in different orders", () => {
    const a = { level1: { level2: { x: 1, y: 2 }, other: "foo" } };
    const b = { level1: { other: "foo", level2: { y: 2, x: 1 } } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("does not throw on cyclic references — falls back to String()", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).not.toThrow();
    // Fallback path returns `String(value)` which for a plain object is
    // "[object Object]".
    expect(stableStringify(cyclic)).toBe("[object Object]");
  });

  it("handles empty objects and empty arrays", () => {
    expect(stableStringify({})).toBe("{}");
    expect(stableStringify([])).toBe("[]");
  });

  it("treats arrays-of-objects by sorting keys within each object", () => {
    const a = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
    const b = [{ b: 2, a: 1 }, { b: 4, a: 3 }];
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
