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

// The watchlist subscription reaches the Tauri store plugin (onKeyChange
// lazily loads the store file), which crashes outside a Tauri webview.
// Reads are fine (in-memory cache) — only the listener needs stubbing.
vi.mock("../lib/store", () => ({
  getStore: vi.fn((_key: string, fallback: unknown) => fallback),
  setStore: vi.fn(),
  onStoreChange: vi.fn(() => vi.fn()),
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

  it("does not render a pinned widget that is not in activeTabs", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["finance"]}
        widgetData={widgetData}
        pinnedWidgets={{ timer: { side: "right" } }}
      />,
    );

    expect(screen.queryByText("Timer")).not.toBeInTheDocument();
    expect(screen.queryByText("01:05")).not.toBeInTheDocument();
  });

  it("renders a pinned widget that is in activeTabs", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["timer"]}
        widgetData={widgetData}
        pinnedWidgets={{ timer: { side: "right" } }}
      />,
    );

    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByText("01:05")).toBeInTheDocument();
  });
});
