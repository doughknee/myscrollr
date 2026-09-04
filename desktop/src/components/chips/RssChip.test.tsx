/**
 * The headline chip's contract: compact is the first line of the title;
 * detailed adds whatever the title still needs -- the summary on line two
 * if the title fit, inline after it if it wrapped -- without ever widening
 * the chip. jsdom has no layout, so fit is driven by stubbing the widths
 * the hook reads.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RssChip from "./RssChip";
import type { RssItem } from "../../types";

function item(over: Partial<RssItem> = {}): RssItem {
  return {
    id: 1,
    feed_url: "https://www.engadget.com/rss.xml",
    guid: "g1",
    title: "What Is The Best Waterproof Rating For Bluetooth Speakers?",
    link: "https://example.com/1",
    description: "There&#39;s nothing like lounging by the pool, listening to your favorite tunes.",
    source_name: "Engadget",
    published_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

// The hook compares the hidden sizer's scrollWidth to the cell's clientWidth.
function stubWidths(sizer: number, cell: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return sizer; } });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return cell; } });
}
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

describe("RssChip", () => {
  it("compact is the headline alone, entities decoded, source as a tab", () => {
    render(<RssChip item={item()} />);
    expect(screen.getByText("What Is The Best Waterproof Rating For Bluetooth Speakers?")).toBeTruthy();
    expect(screen.getByText("ENGADGET")).toBeTruthy();
    expect(screen.queryByText(/lounging/)).toBeNull();
    expect(screen.getByTestId("age-cell").textContent).toBe("12m");
  });

  it("puts the summary on line two when the title fit on one", () => {
    stubWidths(400, 520);
    render(<RssChip item={item()} comfort />);
    expect(screen.getByTestId("summary-break")).toBeTruthy();
    // decoded: &#39; became an apostrophe
    expect(screen.getByText(/There's nothing like lounging/)).toBeTruthy();
  });

  it("runs the summary on after a title that wrapped", () => {
    stubWidths(900, 520);
    render(<RssChip item={item()} comfort />);
    expect(screen.queryByTestId("summary-break")).toBeNull();
    expect(screen.getByText(/There's nothing like lounging/)).toBeTruthy();
  });

  it("shows the feed's volume when there is no summary and the title fit", () => {
    stubWidths(300, 520);
    render(<RssChip item={item({ description: "", source_name: "Dev.to" })} comfort feedCountToday={34} />);
    expect(screen.getByText("Dev.to · 34 today")).toBeTruthy();
  });

  it("says nothing on line two when there is no summary and the title wrapped", () => {
    stubWidths(900, 520);
    const { container } = render(<RssChip item={item({ description: "" })} comfort feedCountToday={34} />);
    expect(container.textContent).not.toContain("today");
  });

  it("shortens a long source name for the tab", () => {
    render(<RssChip item={item({ source_name: "The Hollywood Reporter" })} />);
    expect(screen.getByText("HOLLYWOOD")).toBeTruthy();
  });

  it("fixes the age column at the same width in both modes", () => {
    const { container, rerender } = render(<RssChip item={item()} />);
    const cls = () => (container.querySelector("button") as HTMLButtonElement).className;
    expect(cls()).toContain("_46px]");
    rerender(<RssChip item={item()} comfort />);
    expect(cls()).toContain("_46px]");
  });

  it("tints from the widget's brand in widget mode only", () => {
    const { container, rerender } = render(<RssChip item={item()} accent="#052962" />);
    const btn = () => container.querySelector("button") as HTMLButtonElement;
    expect(btn().style.getPropertyValue("--accent")).not.toBe("");
    rerender(<RssChip item={item()} accent="#052962" colorMode="muted" />);
    expect(btn().style.getPropertyValue("--accent")).toBe("");
  });
});
