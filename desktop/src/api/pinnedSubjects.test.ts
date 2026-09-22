import { describe, it, expect, beforeEach } from "vitest";

import {
  syncPinnedSubjects,
  pinnedSubjectsQuery,
  resetPinnedSubjects,
} from "./pinnedSubjects";
import type { WidgetPin } from "../preferences";

const pin = (widget: string, subject: string): WidgetPin => ({
  widget,
  subject,
  side: "right",
});

const sourceOf = (widget: string) =>
  widget.startsWith("sports") ? "sports"
  : widget.startsWith("finance") ? "finance"
  : widget.startsWith("news") ? "rss"
  : undefined;

describe("pinnedSubjects", () => {
  beforeEach(resetPinnedSubjects);

  it("sends nothing when nothing is pinned", () => {
    expect(syncPinnedSubjects([], sourceOf)).toBe(false);
    expect(pinnedSubjectsQuery()).toBe("");
  });

  it("maps a widget to its data source", () => {
    expect(syncPinnedSubjects([pin("sports_mlb", "Milwaukee Brewers")], sourceOf)).toBe(true);
    expect(decodeURIComponent(pinnedSubjectsQuery())).toBe(
      `?pins=[["sports","Milwaukee Brewers"]]`,
    );
  });

  // Clock, weather and friends have no dashboard section, so there is
  // nothing for the server to guarantee.
  it("drops a subject with no data source", () => {
    expect(syncPinnedSubjects([pin("clock", "clock")], sourceOf)).toBe(false);
    expect(pinnedSubjectsQuery()).toBe("");
  });

  // Order is the user's, not the wire's: reordering the fixed zone must
  // not cost a refetch.
  it("reports no change when only the order differs", () => {
    const a = pin("sports_mlb", "Milwaukee Brewers");
    const b = pin("finance_stocks", "AAPL");
    expect(syncPinnedSubjects([a, b], sourceOf)).toBe(true);
    expect(syncPinnedSubjects([b, a], sourceOf)).toBe(false);
  });

  it("reports a change when a pin is added or removed", () => {
    const a = pin("sports_mlb", "Milwaukee Brewers");
    syncPinnedSubjects([a], sourceOf);
    expect(syncPinnedSubjects([a, pin("finance_stocks", "AAPL")], sourceOf)).toBe(true);
    expect(syncPinnedSubjects([a], sourceOf)).toBe(true);
  });

  // A feed URL is a subject, so the parameter has to survive one.
  it("encodes a feed url", () => {
    syncPinnedSubjects([pin("news_bbc", "https://example.com/rss?a=1,2")], sourceOf);
    const query = pinnedSubjectsQuery();
    expect(query).not.toContain(" ");
    expect(JSON.parse(decodeURIComponent(query.slice("?pins=".length)))).toEqual([
      ["rss", "https://example.com/rss?a=1,2"],
    ]);
  });

  // Two widgets over the same source can name the same team.
  it("collapses a duplicate subject", () => {
    syncPinnedSubjects(
      [pin("sports_mlb", "Milwaukee Brewers"), pin("sports_nfl", "Milwaukee Brewers")],
      sourceOf,
    );
    expect(JSON.parse(decodeURIComponent(pinnedSubjectsQuery().slice("?pins=".length)))).toEqual([
      ["sports", "Milwaukee Brewers"],
    ]);
  });
});
