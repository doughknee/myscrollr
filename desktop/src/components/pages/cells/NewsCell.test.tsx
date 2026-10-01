import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NewsCell, { age, BIG_HEADLINE_PX } from "./NewsCell";
import type { RssItem } from "../../../types";

const NOW = Date.parse("2026-10-04T18:40:00Z");

function item(over: Partial<RssItem> = {}): RssItem {
  return {
    id: 1, feed_url: "https://feeds.bbci.co.uk/news/rss.xml", guid: "g", link: "https://bbc.co.uk/x",
    title: "Central bank holds rates as inflation cools for third month", description: "",
    source_name: "BBC News", published_at: new Date(NOW - 29 * 60_000).toISOString(),
    created_at: new Date(NOW - 30 * 60_000).toISOString(), updated_at: "",
    ...over,
  };
}

describe("age", () => {
  it("minutes, then hours, then days", () => {
    expect(age(item(), NOW)).toBe("29m");
    expect(age(item({ published_at: new Date(NOW - 5 * 3_600_000).toISOString() }), NOW)).toBe("5h");
    expect(age(item({ published_at: new Date(NOW - 3 * 86_400_000).toISOString() }), NOW)).toBe("3d");
  });

  it("an undated item is as old as when we first saw it", () => {
    expect(age(item({ published_at: null }), NOW)).toBe("30m");
  });
});

describe("NewsCell", () => {
  it("decodes the headline and shows the summary beneath", () => {
    const { getByText } = render(
      <NewsCell item={item({ title: "Rates &amp; the <b>Fed</b> chair&#39;s view", description: "<p>Markets steady.</p>" })} width={420} now={NOW} />,
    );
    expect(getByText("Rates & the Fed chair's view")).toBeTruthy();
    expect(getByText("Markets steady.")).toBeTruthy();
  });

  it("no summary: the feed's name, never filler", () => {
    const { container } = render(<NewsCell item={item()} width={420} now={NOW} />);
    expect(container.querySelector('[data-part="summary"]')!.textContent).toBe("BBC News");
  });

  it("a wide column sets the headline larger", () => {
    const size = (w: number) =>
      render(<NewsCell item={item()} width={w} now={NOW} />).container.querySelector('[data-part="headline"]')!.classList.contains("text-[15px]");
    expect(size(BIG_HEADLINE_PX)).toBe(true);
    expect(size(BIG_HEADLINE_PX - 1)).toBe(false);
  });

  it("width-stable: the age sits in a fixed column, whatever it says", () => {
    const grid = (published: number) =>
      render(<NewsCell item={item({ published_at: new Date(published).toISOString() })} width={420} now={NOW} />)
        .container.querySelector("button")!.className;
    expect(grid(NOW - 9 * 60_000)).toBe(grid(NOW - 12 * 3_600_000));
    expect(grid(NOW).includes("grid-cols-[26px_minmax(0,1fr)]")).toBe(true);
  });
});
