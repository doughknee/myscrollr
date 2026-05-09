/**
 * undoStack tests — the safety net for Phase 1 undo system.
 *
 * The stack is the heart of the undo affordance: every destructive
 * action in TickerSettings, the widget Trash button, the tier-clamp
 * recovery toast, etc. relies on these contracts holding.
 *
 *   - Push round-trips a deep clone (mutating restored prefs doesn't
 *     poison the snapshot for a future re-restore).
 *   - GC drops snapshots older than `GC_AGE_MS` and only those.
 *   - Cap evicts oldest first (FIFO ring buffer).
 *   - restoreSnapshot returns null for unknown ids without throwing.
 *
 * If any of these break, users will silently lose data they think
 * they can recover. Non-negotiable.
 */
import { beforeEach, describe, it, expect } from "vitest";
import {
  pushSnapshot,
  restoreSnapshot,
  getLatest,
  gcExpired,
  clearAll,
  _getStackSize,
  MAX_SNAPSHOTS,
  GC_AGE_MS,
} from "./undoStack";
import type { AppPreferences } from "../preferences";

function makePrefs(rows: { sources: string[] }[]): AppPreferences {
  return {
    appearance: {
      tickerLayout: { rows },
    },
    widgets: {
      enabledWidgets: [],
      widgetsOnTicker: [],
      pinnedWidgets: {},
    },
  } as unknown as AppPreferences;
}

beforeEach(() => {
  clearAll();
});

describe("pushSnapshot / restoreSnapshot", () => {
  it("round-trips an AppPreferences snapshot by id", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const id = pushSnapshot("Removed Row 1", prefs);
    const restored = restoreSnapshot(id);
    expect(restored).not.toBeNull();
    expect(restored?.appearance.tickerLayout.rows).toEqual([
      { sources: ["finance"] },
    ]);
  });

  it("deep-clones on push so later mutation of the source doesn't leak", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const id = pushSnapshot("Test", prefs);
    // Mutate the original after pushing.
    prefs.appearance.tickerLayout.rows[0].sources.push("sports");
    const restored = restoreSnapshot(id)!;
    expect(restored.appearance.tickerLayout.rows[0].sources).toEqual([
      "finance",
    ]);
  });

  it("deep-clones on restore so mutating the restored prefs doesn't poison future restores", () => {
    const prefs = makePrefs([{ sources: ["finance"] }]);
    const id = pushSnapshot("Test", prefs);
    const restored1 = restoreSnapshot(id)!;
    restored1.appearance.tickerLayout.rows[0].sources.push("rss");
    const restored2 = restoreSnapshot(id)!;
    expect(restored2.appearance.tickerLayout.rows[0].sources).toEqual([
      "finance",
    ]);
  });

  it("returns null for an unknown id", () => {
    expect(restoreSnapshot("does-not-exist")).toBeNull();
  });

  it("getLatest returns the most recent snapshot", () => {
    pushSnapshot("first", makePrefs([{ sources: [] }]));
    pushSnapshot("second", makePrefs([{ sources: ["sports"] }]));
    const latest = getLatest();
    expect(latest?.label).toBe("second");
    expect(latest?.prefs.appearance.tickerLayout.rows[0].sources).toEqual([
      "sports",
    ]);
  });

  it("getLatest returns null when stack is empty", () => {
    expect(getLatest()).toBeNull();
  });
});

describe("FIFO eviction at MAX_SNAPSHOTS", () => {
  it("keeps only the most recent MAX_SNAPSHOTS entries", () => {
    // Push one more than the cap. The oldest should be evicted.
    const ids: string[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      ids.push(pushSnapshot(`label-${i}`, makePrefs([{ sources: [`s${i}`] }])));
    }
    expect(_getStackSize()).toBe(MAX_SNAPSHOTS);
    // First 5 ids should be evicted.
    for (let i = 0; i < 5; i++) {
      expect(restoreSnapshot(ids[i])).toBeNull();
    }
    // Last one is still recoverable.
    expect(restoreSnapshot(ids[ids.length - 1])).not.toBeNull();
  });
});

describe("gcExpired", () => {
  it("drops snapshots whose timestamp is older than GC_AGE_MS", () => {
    const id = pushSnapshot("old", makePrefs([{ sources: [] }]));
    // Simulate "now" being far in the future.
    const future = Date.now() + GC_AGE_MS + 1_000;
    gcExpired(future);
    expect(restoreSnapshot(id)).toBeNull();
    expect(_getStackSize()).toBe(0);
  });

  it("keeps snapshots that are still within the GC window", () => {
    const id = pushSnapshot("fresh", makePrefs([{ sources: [] }]));
    // Run GC at "now" — snapshot was just pushed so it's fresh.
    gcExpired(Date.now());
    expect(restoreSnapshot(id)).not.toBeNull();
  });

  it("only drops the leading expired entries; preserves newer ones", () => {
    const oldId = pushSnapshot("old", makePrefs([{ sources: [] }]));
    // Simulate time passing.
    const midpoint = Date.now() + GC_AGE_MS / 2;
    // Now push a fresh snapshot at "midpoint" by stubbing Date.now.
    const realNow = Date.now;
    Date.now = () => midpoint;
    const newId = pushSnapshot("new", makePrefs([{ sources: ["sports"] }]));
    Date.now = realNow;
    // GC at a time that expires the old one but not the new one.
    const cutoff = midpoint + GC_AGE_MS - 1_000;
    gcExpired(cutoff);
    expect(restoreSnapshot(oldId)).toBeNull();
    expect(restoreSnapshot(newId)).not.toBeNull();
  });
});

describe("clearAll", () => {
  it("empties the stack", () => {
    pushSnapshot("a", makePrefs([{ sources: [] }]));
    pushSnapshot("b", makePrefs([{ sources: [] }]));
    expect(_getStackSize()).toBe(2);
    clearAll();
    expect(_getStackSize()).toBe(0);
    expect(getLatest()).toBeNull();
  });
});
