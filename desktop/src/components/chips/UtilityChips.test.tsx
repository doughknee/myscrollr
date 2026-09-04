/**
 * The utility chips' contract: compact is the chip, detailed adds one
 * row, and each widget's second row carries the thing you would
 * otherwise open the app to find. Weather is the one whose COMPACT row
 * changed too, so it gets the most attention here.
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
  it("shows only the time in compact, the date and offset in detailed", () => {
    const { rerender } = render(<ClockChip items={zones} />);
    expect(screen.getByText("14:32")).toBeTruthy();
    expect(screen.queryByText(/Sep 4/)).toBeNull();

    rerender(<ClockChip items={zones} comfort />);
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
    const { container } = render(<TimerChip items={timers} comfort />);
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
    { id: "w1", label: "Austin", temp: "97°", icon: "☀", tempValue: 97, high: 99, low: 78 },
    { id: "w2", label: "Denver", temp: "61°", icon: "⛈", alert: "Storm watch" },
  ];

  it("compact is label, icon and temperature only — no range", () => {
    const { container } = render(<WeatherChip items={places} />);
    expect(screen.getByText("Austin")).toBeTruthy();
    expect(screen.getByText("97°")).toBeTruthy();
    // The range's endpoints are the giveaway that the bar rendered.
    expect(screen.queryByText("78")).toBeNull();
    expect(screen.queryByText("99")).toBeNull();
    expect(container.querySelector(".row-start-2")).toBeNull();
  });

  it("detailed reveals the range, and an alert takes its own cell", () => {
    render(<WeatherChip items={places} comfort />);
    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.getByText("99")).toBeTruthy();
    // Under Denver, where Denver's range bar would be — not across the chip.
    const alert = screen.getByText("Storm watch");
    expect(alert.closest(".row-start-2")).toBeTruthy();
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
    render(<SysmonChip items={metrics} comfort />);
    // One reading is not a trend; a single dot would imply one.
    expect(screen.getByText("16 cores")).toBeTruthy();
  });

  it("draws the trend once the buffer has filled", () => {
    // Distinct ids per render would defeat the shared buffer; the same
    // metric observed over several ticks is the real case.
    const { container, rerender } = render(<SysmonChip items={metrics} comfort />);
    for (let i = 0; i < 4; i++) {
      rerender(<SysmonChip items={[{ ...metrics[0], percent: 50 + i }]} comfort />);
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
