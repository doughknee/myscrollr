import { describe, it, expect } from "vitest";
import { liftForTint } from "./chipAccent";

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
};

describe("liftForTint", () => {
  it("leaves a colour that already reads as a tint alone", () => {
    // Vivid reds have a LOW HSL lightness and a high luminance; the gate
    // must be the latter or F1 turns salmon.
    for (const hex of ["#e10600", "#c9082a", "#e2001a", "#d20a0a", "#d2691e", "#2e7d46"]) {
      expect(liftForTint(hex), hex).toBe(hex);
    }
  });

  it("lifts the dark navies to something a 6% tint can show", () => {
    for (const hex of ["#001838", "#013369", "#002d72", "#0e1e5b", "#111827"]) {
      const out = liftForTint(hex);
      expect(lum(out), `${hex} -> ${out}`).toBeGreaterThan(lum(hex) * 3);
      expect(lum(out)).toBeGreaterThan(90);
    }
  });

  it("keeps the hue: MLS stays blue, Premier League stays purple", () => {
    const mls = liftForTint("#001838");
    const n = parseInt(mls.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    const epl = liftForTint("#37003c");
    const m = parseInt(epl.slice(1), 16);
    expect((m >> 16) & 255).toBeGreaterThan((m >> 8) & 255); // r > g: still purple
  });

  it("passes through anything it cannot parse", () => {
    expect(liftForTint("navy")).toBe("navy");
  });
});
