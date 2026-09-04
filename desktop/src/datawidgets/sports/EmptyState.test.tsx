/**
 * The complaint these cover: "it's confusing when some games say no games
 * to show when they are not in season, it's hard to realize that."
 *
 * The season-aware empty state already existed — the Home feed used it —
 * but the widget page rendered a flat "No games to show" instead, so the
 * one surface a user opens to ask "where are my games?" was the one that
 * would not answer. These pin the answers, and the single-league phrasing
 * a per-league page (/widget/sports_mls) needs.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SportsEmptyState from "./EmptyState";
import type { LeagueMeta } from "../../api/queries";

function league(over: Partial<LeagueMeta> & { name: string }): LeagueMeta {
  return {
    is_offseason: false,
    next_game: null,
    polling_healthy: true,
    ...over,
  };
}

// Far enough out that formatCountdown renders a date, not a countdown.
const MARCH = new Date(Date.now() + 120 * 86_400_000).toISOString();

describe("SportsEmptyState", () => {
  it("names the league when only one is off-season", () => {
    render(<SportsEmptyState leagues={[league({ name: "MLS", is_offseason: true, next_game: MARCH })]} />);
    expect(screen.getByText(/MLS is off-season/i)).toBeTruthy();
    // Not the plural phrasing — on /widget/sports_mls there is no "your
    // leagues" to speak of, only the one in the header.
    expect(screen.queryByText(/All your leagues/i)).toBeNull();
  });

  it("keeps the plural phrasing for several off-season leagues", () => {
    render(
      <SportsEmptyState
        leagues={[
          league({ name: "NBA", is_offseason: true, next_game: MARCH }),
          league({ name: "NHL", is_offseason: true, next_game: MARCH }),
        ]}
      />,
    );
    expect(screen.getByText(/All your leagues are off-season/i)).toBeTruthy();
  });

  it("says off-season even with no return date known", () => {
    render(<SportsEmptyState leagues={[league({ name: "NHL", is_offseason: true })]} />);
    expect(screen.getByText(/NHL is off-season/i)).toBeTruthy();
    expect(screen.getByText(/Returns next season/i)).toBeTruthy();
  });

  it("distinguishes in-season-but-quiet from off-season", () => {
    // NFL in March has offseason_months covering the month; NFL in
    // September with an unpublished fixture list does not. Both used to
    // render the same sentence.
    render(<SportsEmptyState leagues={[league({ name: "NFL" })]} />);
    expect(screen.getByText(/NFL has nothing scheduled/i)).toBeTruthy();
    expect(screen.getByText(/In season/i)).toBeTruthy();
    expect(screen.queryByText(/off-season/i)).toBeNull();
  });

  it("puts a polling outage ahead of the season story", () => {
    // A stale poller looks exactly like an empty league from the UI. It
    // is not the user's problem to diagnose, so it wins over every
    // season branch below it.
    render(
      <SportsEmptyState
        leagues={[league({ name: "MLS", is_offseason: true, polling_healthy: false })]}
      />,
    );
    expect(screen.getByText(/Live data unavailable/i)).toBeTruthy();
  });
});
