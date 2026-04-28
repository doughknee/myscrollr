import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AccountStatsRow from "./AccountStatsRow";

describe("AccountStatsRow", () => {
  it("renders nothing when total channels is 0", () => {
    const { container } = render(
      <AccountStatsRow
        channelsTotal={0}
        channelsEnabled={0}
        fantasy={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the channel count when channels exist", () => {
    render(
      <AccountStatsRow
        channelsTotal={4}
        channelsEnabled={3}
        fantasy={null}
      />
    );
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/4/)).toBeInTheDocument();
    expect(screen.getByText(/channels enabled/i)).toBeInTheDocument();
  });

  it("hides fantasy line when fantasy is null", () => {
    render(
      <AccountStatsRow
        channelsTotal={2}
        channelsEnabled={2}
        fantasy={null}
      />
    );
    expect(screen.queryByText(/fantasy league/i)).toBeNull();
  });

  it("shows fantasy league count when connected", () => {
    const { container } = render(
      <AccountStatsRow
        channelsTotal={2}
        channelsEnabled={2}
        fantasy={{ yahoo_connected: true, yahoo_synced: true, league_count: 3 }}
      />
    );
    // Count + label live in adjacent spans (bold count, muted label).
    // Match against the parent's flattened textContent.
    expect(container.textContent).toMatch(/3\s*fantasy league/i);
  });
});
