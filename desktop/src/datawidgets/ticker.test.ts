/**
 * The one rotation every flooding source shares. Sports and news test
 * their own reservations; this covers the arithmetic with none.
 */
import { describe, it, expect } from "vitest";
import { rotateSlots } from "./ticker";

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
