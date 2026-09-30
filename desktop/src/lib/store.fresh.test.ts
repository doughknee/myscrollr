import { afterEach, describe, expect, it, vi } from "vitest";

const entries = vi.hoisted(() => ({ value: [] as [string, unknown][] }));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async entries() {
      return entries.value;
    }
    async set() {}
    async delete() {
      return true;
    }
    async save() {}
    async onKeyChange() {
      return () => {};
    }
  },
}));

async function freshStore() {
  vi.resetModules();
  const s = await import("./store");
  await s.initStore();
  return s;
}

afterEach(() => localStorage.clear());

describe("initStore fresh-install marker (SCROLLR-263)", () => {
  it("empty store, nothing to migrate: marks a fresh install", async () => {
    entries.value = [];
    const s = await freshStore();
    expect(s.getStore(s.FRESH_INSTALL_KEY, false)).toBe(true);
  });

  it("migrated store (an existing install): no marker", async () => {
    entries.value = [["scrollr:store-migrated", true]];
    const s = await freshStore();
    expect(s.getStore(s.FRESH_INSTALL_KEY, false)).toBe(false);
  });

  it("legacy localStorage prefs (pre-store install): no marker", async () => {
    entries.value = [];
    localStorage.setItem("scrollr:settings", "{}");
    const s = await freshStore();
    expect(s.getStore(s.FRESH_INSTALL_KEY, false)).toBe(false);
  });
});
