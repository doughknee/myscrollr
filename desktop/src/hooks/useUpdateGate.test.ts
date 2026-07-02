import { describe, expect, it } from "vitest";
import { compareVersions } from "./useUpdateGate";

describe("compareVersions", () => {
  it("orders plain semver correctly", () => {
    expect(compareVersions("1.0.20", "1.1.0")).toBe(-1);
    expect(compareVersions("1.1.0", "1.0.20")).toBe(1);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBe(-1);
  });

  it("fails open on junk segments (compares as 0)", () => {
    expect(compareVersions("abc", "0.0.0")).toBe(0);
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
  });
});
