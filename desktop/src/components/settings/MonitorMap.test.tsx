import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MonitorMap, monitorLabel, type MonitorInfo } from "./MonitorMap";

// Brandon's desk as `list_monitors` reports it (REL-203): two 3440×1440
// at 100 % and a 3840×2160 at 300 % to the right. Logically DISPLAY3 is
// 1280 wide at x≈1147 — inside DISPLAY1.
const mon = (
  name: string,
  [px, py, pw, ph]: [number, number, number, number],
  scale: number,
  isPrimary = false,
): MonitorInfo => ({
  name,
  x: px / scale,
  y: py / scale,
  width: pw / scale,
  height: ph / scale,
  scaleFactor: scale,
  isPrimary,
  physicalX: px,
  physicalY: py,
  physicalWidth: pw,
  physicalHeight: ph,
});
const DESK = [
  mon("\\\\.\\DISPLAY1", [0, 0, 3440, 1440], 1, true),
  mon("\\\\.\\DISPLAY2", [-3440, 0, 3440, 1440], 1),
  mon("\\\\.\\DISPLAY3", [3440, 0, 3840, 2160], 3),
];

// Names hold backslashes, so index the <g>s rather than select by attribute.
const groupAt = (el: HTMLElement, i: number) => el.querySelectorAll("g[data-monitor]")[i];
const rectOf = (el: HTMLElement, i: number) => {
  const r = groupAt(el, i).querySelector("rect")!;
  const n = (a: string) => Number(r.getAttribute(a));
  return { x: n("x"), y: n("y"), w: n("width"), h: n("height") };
};

describe("MonitorMap", () => {
  it("draws physical rects, so mixed-DPI screens sit side by side without overlap", () => {
    const { container } = render(<MonitorMap monitors={DESK} on={new Set()} />);
    const rects = DESK.map((_, i) => rectOf(container, i));
    expect(rects[2]).toEqual({ x: 3440, y: 0, w: 3840, h: 2160 });
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    // 2 | 1 | 3 left to right, top-aligned
    expect(rects.map((r) => r.x).sort((p, q) => p - q)).toEqual([-3440, 0, 3440]);
    expect(rects.every((r) => r.y === 0)).toBe(true);
  });

  it("numbers screens in list order, matching Identify and the row labels", () => {
    const { container } = render(<MonitorMap monitors={DESK} on={new Set()} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toEqual(["1", "2", "3"]);
    expect(monitorLabel(2, DESK[2])).toBe("Display 3 · 3840 × 2160");
  });

  it("click toggles a screen, except the last one on", () => {
    const onToggle = vi.fn();
    const on = new Set([DESK[0].name]);
    const { container } = render(<MonitorMap monitors={DESK} on={on} onToggle={onToggle} />);
    fireEvent.click(groupAt(container, 2));
    expect(onToggle).toHaveBeenCalledWith(DESK[2].name, true);
    fireEvent.click(groupAt(container, 0));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
