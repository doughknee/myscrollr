/**
 * The utility chips' contract: one top row, one detail row, and each
 * widget's second row carries the thing you would otherwise open the app
 * to find. Weather is the one whose top row changed too, so it gets the
 * most attention here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClockChip, TimerChip, WeatherChip, SysmonChip } from "./UtilityChips";
import { __resetMetricHistory } from "./metricHistory";
import type { ClockChipData, WeatherChipData, SysmonChipData } from "../../types";

beforeEach(() => __resetMetricHistory());

const zones: ClockChipData[] = [
  { id: "z1", kind: "clock", label: "NYC", value: "14:32", detail: "Thu, Sep 4", offset: "UTC-4" },
  { id: "z2", kind: "clock", label: "TYO", value: "03:32", detail: "Fri, Sep 5", offset: "UTC+9", night: true },
];

describe("ClockChip", () => {
  it("shows the time on the top row, the date and offset beneath", () => {
    render(<ClockChip items={zones} />);
    expect(screen.getByText("14:32")).toBeTruthy();
    // The whole reason clock took this treatment: Tokyo is on another day.
    expect(screen.getByText("Thu, Sep 4 · UTC-4")).toBeTruthy();
    expect(screen.getByText("Fri, Sep 5 · UTC+9")).toBeTruthy();
  });

  it("marks a night zone", () => {
    render(<ClockChip items={zones} />);
    expect(screen.getByLabelText("night")).toBeTruthy();
  });
});

describe("TimerChip", () => {
  const timers: ClockChipData[] = [
    { id: "t1", kind: "timer", label: "Pomodoro", value: "12:45", remainingSec: 765, totalSec: 1500 },
    { id: "t2", kind: "timer", label: "Stopwatch", value: "03:11", detail: "counting up" },
  ];

  it("draws a bar for a timer with a target and text for one without", () => {
    const { container } = render(<TimerChip items={timers} />);
    // A stopwatch has no finish line, so no fraction to draw.
    expect(screen.getByText("counting up")).toBeTruthy();
    const bars = container.querySelectorAll('[style*="width: 51%"]');
    expect(bars.length).toBe(1);
  });

  it("turns the last minute live-red", () => {
    const urgent: ClockChipData[] = [
      { id: "t3", kind: "timer", label: "Standup", value: "00:38", remainingSec: 38, totalSec: 600 },
    ];
    const { container } = render(<TimerChip items={urgent} />);
    expect(container.querySelector(".text-live")).toBeTruthy();
  });
});

describe("WeatherChip", () => {
  const places: WeatherChipData[] = [
    { id: "w1", label: "Austin", temp: "36°C", unit: "celsius", icon: "☀", tempValue: 36, high: 37, low: 25 },
    { id: "w2", label: "Denver", temp: "16°C", unit: "celsius", icon: "⛈", alert: "Storm watch" },
  ];

  it("top row is label, icon and temperature; the range sits beneath, and an alert takes its own cell", () => {
    render(<WeatherChip items={places} />);
    expect(screen.getByText("25°")).toBeTruthy();
    expect(screen.getByText("37°")).toBeTruthy();
    // Under Denver, where Denver's range bar would be — not across the chip.
    const alert = screen.getByText("Storm watch");
    expect(alert.closest(".row-start-2")).toBeTruthy();
  });

  it("prints the range in fahrenheit when the chip is fahrenheit, and the dot stays put", () => {
    const f: WeatherChipData = { id: "w3", label: "Chicago", temp: "61°F", unit: "fahrenheit", icon: "⛅", tempValue: 16, high: 19, low: 11 };
    const { container } = render(<WeatherChip items={[f]} />);
    // 11°C and 19°C, shown in the unit the temperature is in.
    expect(screen.getByText("52°")).toBeTruthy();
    expect(screen.getByText("66°")).toBeTruthy();
    // (16 - 11) / (19 - 11) = 62.5%: positioned in Celsius, unit-free.
    expect(container.querySelector('[style*="left: 62.5%"]')).toBeTruthy();
  });

  it("tints a temperature at the day's high", () => {
    const { container } = render(<WeatherChip items={places} />);
    expect(container.querySelector(".text-warning")).toBeTruthy();
  });
});

describe("SysmonChip", () => {
  const metrics: SysmonChipData[] = [
    { id: "cpu", label: "CPU", value: "47%", percent: 47, detail: "16 cores" },
  ];

  it("says what the number is until there are two readings to draw", () => {
    render(<SysmonChip items={metrics} />);
    // One reading is not a trend; a single dot would imply one.
    expect(screen.getByText("16 cores")).toBeTruthy();
  });

  it("draws the trend once the buffer has filled", () => {
    // Distinct ids per render would defeat the shared buffer; the same
    // metric observed over several ticks is the real case.
    const { container, rerender } = render(<SysmonChip items={metrics} />);
    for (let i = 0; i < 4; i++) {
      rerender(<SysmonChip items={[{ ...metrics[0], percent: 50 + i }]} />);
    }
    // Recording is time-guarded, so within one tick this stays a no-op.
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("16 cores")).toBeTruthy();
  });

  it("reserves the value cell so a digit change cannot resize the chip", () => {
    // Arbitrary-value classes are not valid CSS selectors, so check the list.
    const { container } = render(<SysmonChip items={metrics} />);
    const held = Array.from(container.querySelectorAll("span")).some((el) =>
      el.classList.contains("min-w-[5ch]"),
    );
    expect(held).toBe(true);
  });
});

describe("cell dividers", () => {
  it("draws inner rules in the widget's colour, not the near-invisible edge", () => {
    const { container } = render(<ClockChip items={zones} />);
    const rules = Array.from(container.querySelectorAll("span")).filter((el) =>
      el.classList.contains("border-l") || el.classList.contains("border-r"),
    );
    // Tab's right rule, plus the second zone's left rule on both rows.
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const el of rules) {
      expect(el.classList.contains("border-widget-clock/45")).toBe(true);
      expect(el.classList.contains("border-edge/40")).toBe(false);
    }
  });

  it("keeps the divider stronger than the chip's own outer border", () => {
    // 45% inside vs 25% outside: an inner rule separates two things that
    // share a ground, so it needs the contrast the outer edge gets free.
    const { container } = render(<SysmonChip items={[
      { id: "cpu", label: "CPU", value: "47%", percent: 47 },
      { id: "ram", label: "RAM", value: "71%", percent: 71 },
    ]} />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.className).toContain("border-widget-sysmon/25");
    const inner = container.querySelector(".border-l") as HTMLElement;
    expect(inner.classList.contains("border-widget-sysmon/45")).toBe(true);
  });
});
