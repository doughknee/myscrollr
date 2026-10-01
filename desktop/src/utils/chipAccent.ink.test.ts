// @vitest-environment node
// @ts-expect-error -- the desktop tsconfig has no node types; vitest runs this in node.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { liftForTint, luminance, readableInk } from "./chipAccent";
import catalog from "../catalog.snapshot.json";

// Read from disk: vitest hands CSS imports (even `?raw`) back empty.
const css: string = readFileSync(new URL("../style.css", import.meta.url), "utf8");

/**
 * SCROLLR-287: `readableInk` is the widget colour as text on the bar. Its
 * bounds are a claim about the palettes, so check it against the palettes:
 * every catalog colour on every palette's bar (base-150), bare and under the
 * label's tint of that colour (16% dark, 12% light), at 4.5:1.
 */
type RGB = [number, number, number];
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top: RGB, under: RGB, p: number) => top.map((v, i) => v * p + under[i] * (1 - p)) as RGB;

const bars: [string, string][] = [["scrollr-dark", /@theme \{[\s\S]*?--color-base-150: (#[0-9a-f]{6})/i.exec(css)![1]]];
for (const m of css.matchAll(/#desktop-shell\[data-theme="([\w-]+)"\][^{]*\{([\s\S]*?)\n\}/g)) {
  const bar = /--color-base-150: (#[0-9a-f]{6})/i.exec(m[2]);
  if (bar) bars.push([m[1], bar[1]]);
}
const colours = [...new Set((catalog as { widgets: { color: string }[] }).widgets.map((w) => w.color))];

describe("readableInk", () => {
  it("found every palette and catalog colour", () => {
    expect(bars.length).toBe(20);
    expect(colours.length).toBeGreaterThan(40);
  });

  it("reads at 4.5:1 on every bar, bare and under the label's tint", () => {
    const misses: string[] = [];
    for (const [theme, bar] of bars) {
      const dark = theme.endsWith("-dark");
      for (const hex of colours) {
        const accent = dark ? liftForTint(hex) : hex;
        const ink = rgb(readableInk(accent, dark));
        const tint = over(rgb(accent), rgb(bar), dark ? 0.16 : 0.12);
        const worst = Math.min(ratio(ink, rgb(bar)), ratio(ink, tint));
        if (worst < 4.5) misses.push(`${theme} ${hex}: ${worst.toFixed(2)}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("leaves a colour that already reads alone, and keeps the hue of one it moves", () => {
    expect(readableInk("#013369", false)).toBe("#013369"); // NFL navy on light
    const crypto = rgb(readableInk("#f7931a", false)); // orange on light: darkened, still orange
    expect(readableInk("#f7931a", false)).not.toBe("#f7931a");
    expect(crypto[0]).toBeGreaterThan(crypto[1]);
    expect(crypto[1]).toBeGreaterThan(crypto[2]);
  });
});
