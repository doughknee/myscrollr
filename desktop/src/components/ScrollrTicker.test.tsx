import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ScrollrTicker from "./ScrollrTicker";
import type React from "react";
import type { WidgetTickerData } from "../types";

vi.mock("motion-plus/react", () => ({
  Ticker: ({ items }: { items: React.ReactNode[] }) => (
    <div data-testid="ticker-items">{items}</div>
  ),
}));

vi.mock("motion/react", () => ({
  useMotionValue: () => ({
    get: () => 0,
    set: vi.fn(),
  }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const widgetData: WidgetTickerData = {
  clock: [],
  timer: [
    {
      id: "timer",
      kind: "timer",
      label: "Timer",
      value: "01:05",
      detail: "Stopwatch",
    },
  ],
  weather: [],
  sysmon: [],
  uptime: [],
  github: [],
};

describe("ScrollrTicker", () => {
  it("renders timer widget chips from widgetData.timer", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["timer"]}
        widgetData={widgetData}
      />,
    );

    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByText("01:05")).toBeInTheDocument();
  });
});
