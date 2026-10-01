import { afterEach, describe, expect, it } from "vitest";
import { currentEdgeRoom, recordEdge, resetEdge } from "./edgeMeasure";

afterEach(resetEdge);

describe("the shared edge measure", () => {
  it("nothing reported: no room known", () => {
    expect(currentEdgeRoom()).toBeNull();
  });

  it("the narrowest bar and the widest utilities strip win", () => {
    recordEdge({ label: "ticker", bar: 2560, util: 194 });
    recordEdge({ label: "ticker-2", bar: 1280, util: 102 });
    expect(currentEdgeRoom()).toEqual({ bar: 1280, util: 194 });
  });

  it("a window that stopped reporting ages out", () => {
    recordEdge({ label: "ticker", bar: 2560, util: 100 }, 0);
    recordEdge({ label: "ticker-2", bar: 1280, util: 100 }, 20_000);
    // ticker is 20 s stale at the second report: only ticker-2 is left.
    expect(currentEdgeRoom()).toEqual({ bar: 1280, util: 100 });
  });
});
