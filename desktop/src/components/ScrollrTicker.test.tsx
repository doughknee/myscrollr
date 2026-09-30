import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ScrollrTicker from "./ScrollrTicker";
import type React from "react";
import type { DashboardResponse, WidgetTickerData } from "../types";

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

  it("does not render a pinned subject whose widget is not in activeTabs", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["finance"]}
        widgetData={widgetData}
        pins={[{ widget: "timer", subject: "timer", side: "right" }]}
      />,
    );

    expect(screen.queryByText("Timer")).not.toBeInTheDocument();
    expect(screen.queryByText("01:05")).not.toBeInTheDocument();
  });

  it("renders a pinned subject whose widget is in activeTabs", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["timer"]}
        widgetData={widgetData}
        pins={[{ widget: "timer", subject: "timer", side: "right" }]}
      />,
    );

    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByText("01:05")).toBeInTheDocument();
  });

  // The de-duplication rule (§8.5): a pinned subject is lifted OUT of the
  // scrolling tape, so it is on the bar exactly once. Before REL-239 a
  // pinned widget was skipped by widget id; now it is skipped by subject,
  // and this is the test that the swap did not quietly drop the rule.
  it("renders a pinned single-chip utility exactly once", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["timer"]}
        widgetData={widgetData}
        pins={[{ widget: "timer", subject: "timer", side: "right" }]}
      />,
    );

    expect(screen.getAllByText("01:05")).toHaveLength(1);
  });

  // Presence reporting (SCROLLR-210): the screen reports the catalog ids
  // that actually produced a chip, so a tab with no data is not
  // "displayed", a pinned widget is, and the reporter is told once per
  // change rather than once per render.
  it("reports the displayed widget ids, not the configured tabs", () => {
    const onDisplayedWidgetsChange = vi.fn();
    const { rerender } = render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["clock", "timer", "weather"]}
        widgetData={widgetData}
        onDisplayedWidgetsChange={onDisplayedWidgetsChange}
      />,
    );
    expect(onDisplayedWidgetsChange).toHaveBeenLastCalledWith(["timer"]);
    expect(onDisplayedWidgetsChange).toHaveBeenCalledTimes(1);

    rerender(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["clock", "timer", "weather"]}
        widgetData={widgetData}
        pins={[{ widget: "timer", subject: "timer", side: "right" }]}
        onDisplayedWidgetsChange={onDisplayedWidgetsChange}
      />,
    );
    // Pinned out of the tape, still on the screen: same set, no new call.
    expect(onDisplayedWidgetsChange).toHaveBeenCalledTimes(1);

    rerender(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["clock"]}
        widgetData={widgetData}
        onDisplayedWidgetsChange={onDisplayedWidgetsChange}
      />,
    );
    expect(onDisplayedWidgetsChange).toHaveBeenLastCalledWith([]);
    expect(onDisplayedWidgetsChange).toHaveBeenCalledTimes(2);
  });

  it("renders nothing for a pinned subject the widget has no chip for", () => {
    render(
      <ScrollrTicker
        dashboard={null}
        activeTabs={["timer"]}
        widgetData={widgetData}
        pins={[{ widget: "timer", subject: "not-a-subject", side: "right" }]}
      />,
    );

    // The pin resolves to nothing, so the zone is empty -- and the timer
    // is NOT lifted out of the tape, because that subject was never pinned.
    expect(screen.getAllByText("01:05")).toHaveLength(1);
    expect(document.querySelector(".ticker-pinned-zone")).toBeNull();
  });
});

// ── Status chip (SCROLLR-264, CHIP_SPEC §8.7) ──────────────────────

describe("ScrollrTicker status chip", () => {
  const PBS = "https://www.pbs.org/newshour/feeds/rss/headlines";
  const old = new Date(Date.now() - 60 * 3_600_000).toISOString();
  const fresh = new Date(Date.now() - 3_600_000).toISOString();
  const item = (id: number, published_at: string) => ({
    id,
    feed_url: PBS,
    guid: `g${id}`,
    title: `Headline ${id}`,
    link: `https://pbs.example/${id}`,
    description: "",
    source_name: "PBS NewsHour",
    published_at,
    created_at: published_at,
  });
  const dash = (rss: unknown[]) =>
    ({
      data: { rss },
      widgets: [
        {
          id: 1,
          widget_type: "news_pbs",
          enabled: true,
          ticker_enabled: true,
          config: { feeds: [{ name: "PBS NewsHour", url: PBS }] },
        },
      ],
    }) as unknown as DashboardResponse;

  it("puts exactly one status chip on the rail for a widget with nothing in its floor", () => {
    const onDisplayedWidgetsChange = vi.fn();
    render(
      <ScrollrTicker
        dashboard={dash([item(1, old), item(2, old)])}
        activeTabs={["news_pbs"]}
        widgetData={widgetData}
        onDisplayedWidgetsChange={onDisplayedWidgetsChange}
      />,
    );
    const chips = screen.getAllByTestId("status-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("PBS NEWSHOUR");
    expect(chips[0]).toHaveTextContent("no headlines in the last 2 days");
    // Not a pin target, not a rotating slot, not "displayed" data.
    const wrap = chips[0].closest("[data-chip]")!;
    expect(wrap.hasAttribute("data-pin-subject")).toBe(false);
    expect(wrap.hasAttribute("data-rotate-slot")).toBe(false);
    expect(onDisplayedWidgetsChange).toHaveBeenLastCalledWith([]);
  });

  it("is gone the moment the widget has a real chip", () => {
    const { rerender } = render(
      <ScrollrTicker dashboard={dash([item(1, old)])} activeTabs={["news_pbs"]} widgetData={widgetData} />,
    );
    expect(screen.getAllByTestId("status-chip")).toHaveLength(1);
    rerender(
      <ScrollrTicker dashboard={dash([item(1, old), item(2, fresh)])} activeTabs={["news_pbs"]} widgetData={widgetData} />,
    );
    expect(screen.queryByTestId("status-chip")).toBeNull();
    expect(screen.getByText("Headline 2")).toBeInTheDocument();
  });

  it("says nothing before the dashboard is in", () => {
    render(<ScrollrTicker dashboard={null} activeTabs={["news_pbs", "timer"]} widgetData={widgetData} />);
    expect(screen.queryByTestId("status-chip")).toBeNull();
  });

  it("stays off the bar while the widget's pin shows a chip in the fixed zone", () => {
    render(
      <ScrollrTicker
        dashboard={dash([item(1, old)])}
        activeTabs={["news_pbs"]}
        widgetData={widgetData}
        pins={[{ widget: "news_pbs", subject: PBS, side: "right" }]}
      />,
    );
    expect(screen.queryByTestId("status-chip")).toBeNull();
    expect(screen.getByText("Headline 1")).toBeInTheDocument();
  });
});
