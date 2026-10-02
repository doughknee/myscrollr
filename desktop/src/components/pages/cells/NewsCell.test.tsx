import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NewsCell, { age, AGE_CH } from "./NewsCell";
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

  it("two sizes, none under 12px: the headline at 15px at every width, the meta line at 12px", () => {
    for (const w of [400, 426, 584, 900]) {
      const { container } = render(<NewsCell item={item()} width={w} now={NOW} />);
      expect(container.querySelector('[data-part="headline"]')!.classList.contains("text-[15px]")).toBe(true);
      expect(container.querySelector('[data-part="age"]')!.parentElement!.classList.contains("text-[12px]")).toBe(true);
    }
  });

  it("width-stable: the age leads the meta line in a fixed box, whatever it says", () => {
    const ageBox = (published: number) =>
      (render(<NewsCell item={item({ published_at: new Date(published).toISOString() })} width={420} now={NOW} />)
        .container.querySelector('[data-part="age"]') as HTMLElement).style.width;
    expect(ageBox(NOW - 9 * 60_000)).toBe(ageBox(NOW - 12 * 3_600_000));
    expect(ageBox(NOW)).toBe(`${AGE_CH}ch`);
    expect(age(item({ published_at: new Date(NOW - 6.9 * 86_400_000).toISOString() }), NOW).length).toBeLessThanOrEqual(AGE_CH);
  });

  it("a one-line and a two-line headline sit on the same grid: fixed rows, title on top, meta beneath", () => {
    const cell = (title: string) => render(<NewsCell item={item({ title })} width={420} now={NOW} />).container.querySelector("button")!;
    const short = cell("Rates hold");
    const long = cell("Central bank holds rates as inflation cools for a third month while markets wait on the next jobs report");
    expect(short.className).toBe(long.className);
    expect(short.className.includes("grid-rows-[38px_15px]")).toBe(true);
    // The age is in the meta line, not a column of its own beside the headline.
    expect(short.querySelector('[data-part="age"]')!.parentElement!.contains(short.querySelector('[data-part="summary"]'))).toBe(true);
  });
});
