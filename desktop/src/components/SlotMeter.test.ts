/**
 * SlotMeter pure-logic tests — the slot math + copy shared by the
 * Catalog header and the Account page (v1.1.2).
 */
import { describe, expect, it } from "vitest";
import { computeSlotUsage, slotHeadline, slotSubline } from "./SlotMeter";

describe("computeSlotUsage", () => {
  it("sums enabled widgets and enabled local widgets", () => {
    const u = computeSlotUsage(2, 1, 6);
    expect(u).toEqual({ used: 3, max: 6, finite: true, atCapacity: false });
  });

  it("flags capacity at exactly the cap", () => {
    expect(computeSlotUsage(4, 2, 6).atCapacity).toBe(true);
  });

  it("stays at-capacity for grandfathered over-cap users", () => {
    // Downgrade prune disables newest over-cap rows, but a race or a
    // legacy state can leave used > max — still "at capacity", never
    // negative-open or crashing.
    const u = computeSlotUsage(5, 3, 6);
    expect(u.used).toBe(8);
    expect(u.atCapacity).toBe(true);
  });

  it("treats Infinity as unlimited (never at capacity)", () => {
    const u = computeSlotUsage(20, 5, Infinity);
    expect(u.finite).toBe(false);
    expect(u.atCapacity).toBe(false);
  });

  it("zero slots used on a fresh install", () => {
    const u = computeSlotUsage(0, 0, 3);
    expect(u.used).toBe(0);
    expect(u.atCapacity).toBe(false);
  });
});

describe("slotHeadline", () => {
  it("counts against the cap on finite plans", () => {
    expect(slotHeadline(computeSlotUsage(2, 1, 6))).toBe(
      "3 of 6 widget slots used",
    );
  });

  it("announces a full plan", () => {
    expect(slotHeadline(computeSlotUsage(3, 0, 3))).toBe(
      "All 3 widget slots in use",
    );
  });

  it("counts widgets (with pluralization) on unlimited plans", () => {
    expect(slotHeadline(computeSlotUsage(1, 0, Infinity))).toBe(
      "1 widget added",
    );
    expect(slotHeadline(computeSlotUsage(4, 3, Infinity))).toBe(
      "7 widgets added",
    );
  });
});

describe("slotSubline", () => {
  it("invites a first add on a fresh install", () => {
    expect(slotSubline(computeSlotUsage(0, 0, 3))).toMatch(/Fresh start/);
  });

  it("counts open slots with singular/plural forms", () => {
    expect(slotSubline(computeSlotUsage(2, 0, 3))).toBe(
      "1 open slot — room for more.",
    );
    expect(slotSubline(computeSlotUsage(2, 0, 6))).toBe(
      "4 open slots — room for more.",
    );
  });

  it("teaches the swap at capacity", () => {
    expect(slotSubline(computeSlotUsage(3, 0, 3))).toMatch(
      /Remove a widget to free a slot/,
    );
  });

  it("celebrates unlimited plans", () => {
    expect(slotSubline(computeSlotUsage(9, 0, Infinity))).toMatch(/Unlimited/);
  });
});
