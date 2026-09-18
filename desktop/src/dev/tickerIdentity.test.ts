import { describe, it, expect } from "vitest";
import { identity, swapsWhileVisible, type AuditEntry } from "./tickerIdentity";

const entry = (o: Partial<AuditEntry>): AuditEntry => ({
  t: 0, type: "characterData", slot: "spo-slot-0", nodeId: 1, kind: "sports",
  before: "", after: "", chipText: "", visibleWhileChanging: true, ...o,
});

describe("identity", () => {
  it("erases values and keeps names", () => {
    expect(identity("MLBCubs4Reds2IN7")).toBe("MLBCubsRedsIN");
    expect(identity("AAPL$189.32▲+1.2%")).toBe("AAPL");
    expect(identity("1st85-58+14RD2nd80-63")).toBe("");
    expect(identity("12:34:56 PM")).toBe("PM");
  });
});

describe("swapsWhileVisible", () => {
  it("counts a repaint as nothing", () => {
    const es = [
      entry({ chipText: "MLBCubs4Reds2IN7" }),
      entry({ chipText: "MLBCubs5Reds2IN8" }),
    ];
    expect(swapsWhileVisible(es)).toEqual([]);
  });

  it("flags an identity change while visible, not while hidden", () => {
    const base = [entry({ chipText: "MLBCubs4Reds2IN7" })];
    const vis = swapsWhileVisible([...base, entry({ chipText: "MLBYankees1Sox0IN2" })]);
    expect(vis).toHaveLength(1);
    expect(vis[0]).toMatchObject({ before: "MLBCubs4Reds2IN7", after: "MLBYankees1Sox0IN2" });
    const hid = swapsWhileVisible([...base, entry({ chipText: "MLBYankees1Sox0IN2", visibleWhileChanging: false })]);
    expect(hid).toEqual([]);
  });

  it("never diffs two different nodes against each other", () => {
    const es = [
      entry({ nodeId: 1, chipText: "MLBCubs4Reds2IN7" }),
      entry({ nodeId: 2, chipText: "AAPL$189▲" }),
      entry({ nodeId: 1, chipText: "MLBCubs4Reds3IN7" }),
    ];
    expect(swapsWhileVisible(es)).toEqual([]);
  });

  it("flags a visible slot re-key", () => {
    const es = [entry({ type: "attributes", before: "spo-slot-0", after: "spo-slot-1" })];
    expect(swapsWhileVisible(es)).toHaveLength(1);
  });
});
