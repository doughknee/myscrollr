/**
 * The one rotation every flooding source shares. Sports and news test
 * their own reservations; this covers the arithmetic with none.
 */
import { describe, it, expect } from "vitest";
import { rotateSlots, type RotationMemo } from "./ticker";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));
const run = (n: number, slots: number, cycles: Record<string, number> = {}) =>
  rotateSlots(ids(n), slots, cycles, "p", (x) => x.id, () => undefined);

describe("rotateSlots", () => {
  it("keys every item by id and rotates nothing when the pool fits", () => {
    const out = run(3, 4);
    expect(out.map((s) => s.key)).toEqual(["p-s1", "p-s2", "p-s3"]);
    expect(out.every((s) => s.rotateSlot === undefined)).toBe(true);
  });

  it("rotates exactly at the boundary: slots + 1 items become slots positions", () => {
    expect(run(4, 4)).toHaveLength(4);
    const out = run(5, 4);
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.rotateSlot)).toEqual(["p-slot-0", "p-slot-1", "p-slot-2", "p-slot-3"]);
  });

  it("walks each slot through its own residue class on its own count", () => {
    const at = (c: Record<string, number>) => run(7, 3, c).map((s) => s.item.id);
    expect(at({})).toEqual(["s1", "s2", "s3"]);
    expect(at({ "p-slot-0": 1 })).toEqual(["s4", "s2", "s3"]);
    expect(at({ "p-slot-0": 2, "p-slot-2": 1 })).toEqual(["s7", "s2", "s6"]);
    expect(at({ "p-slot-0": 3 })).toEqual(["s1", "s2", "s3"]); // wrapped: class of 3
  });

  it("is what 'add to the watchlist and it rotates' means", () => {
    // Three symbols: all shown. Add a fourth: shown. Add a fifth: rotation.
    expect(run(3, 4).map((s) => s.item.id)).toEqual(["s1", "s2", "s3"]);
    expect(run(4, 4).map((s) => s.item.id)).toEqual(["s1", "s2", "s3", "s4"]);
    const five = run(5, 4);
    expect(five.map((s) => s.item.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(run(5, 4, { "p-slot-0": 1 }).map((s) => s.item.id)).toEqual(["s5", "s2", "s3", "s4"]);
  });

  it("hands each slot's class to the reserve function", () => {
    const seen: string[][] = [];
    rotateSlots(ids(5), 2, {}, "p", (x) => x.id, (cls) => { seen.push(cls.map((x) => x.id)); return null; });
    expect(seen).toEqual([["s1", "s3", "s5"], ["s2", "s4"]]);
  });
});

describe("rotateSlots with a rotation memo (CHIP_DESIGN.md rule 6)", () => {
  const runMemo = (pool: ReturnType<typeof ids>, slots: number, cycles: Record<string, number>, memo: RotationMemo) =>
    rotateSlots(pool, slots, cycles, "p", (x) => x.id, () => undefined, memo);

  it("pool change while visible (same turn) does not change the shown item", () => {
    const memo: RotationMemo = new Map();
    // Rotating case: 5 items into 4 slots, slot-0 owns {s1, s5}.
    const before = runMemo(ids(5), 4, {}, memo);
    expect(before.map((s) => s.item.id)).toEqual(["s1", "s2", "s3", "s4"]);

    // A refetch inserts a new item and reorders the pool -- turn hasn't
    // moved, so every slot must still show what it showed a moment ago.
    const reshuffled = [{ id: "s0" }, ...ids(5)];
    const after = runMemo(reshuffled, 4, {}, memo);
    expect(after.map((s) => s.item.id)).toEqual(["s1", "s2", "s3", "s4"]);

    // Once the slot's own turn advances (it went off screen and back),
    // it is free to pick up the new pool.
    const nextLap = runMemo(reshuffled, 4, { "p-slot-0": 1 }, memo);
    expect(nextLap[0].item.id).not.toBe("s1");
  });

  it("freezes the small-pool case too, keyed by slot instead of id", () => {
    const memo: RotationMemo = new Map();
    const before = runMemo(ids(2), 4, {}, memo);
    expect(before.map((s) => s.key)).toEqual(["p-slot-0", "p-slot-1"]);
    expect(before.map((s) => s.item.id)).toEqual(["s1", "s2"]);

    // A third item joins the pool with the turn unchanged: the two
    // already-visible slots must not repaint. The new item lands in its
    // own, previously-empty slot rather than displacing one on screen.
    const after = runMemo(ids(3), 4, {}, memo);
    expect(after.find((s) => s.key === "p-slot-0")?.item.id).toBe("s1");
    expect(after.find((s) => s.key === "p-slot-1")?.item.id).toBe("s2");
  });
});
