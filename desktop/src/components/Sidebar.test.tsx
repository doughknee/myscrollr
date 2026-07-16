/**
 * Sidebar slot chip — the single add-source affordance doubles as
 * the slot meter: "N of M slots used" states, upgrade flip at cap,
 * plain + on unlimited tiers. See REL-25.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrendingUp } from "lucide-react";
import Sidebar from "./Sidebar";
import type { SubscriptionTier } from "../auth";

function renderSidebar(opts: {
  tier: SubscriptionTier;
  sourceCount: number;
  isFeed?: boolean;
}) {
  const onNavigateToMarketplace = vi.fn();
  const onNavigateHome = vi.fn();
  const sources = Array.from({ length: opts.sourceCount }, (_, i) => ({
    id: `src-${i}`,
    name: `Source ${i}`,
    hex: "#34d399",
    icon: TrendingUp,
    kind: "channel" as const,
    onTicker: false,
  }));
  render(
    <Sidebar
      isSettings={false}
      isTicker={false}
      isAccount={false}
      isMarketplace={false}
      isSupport={false}
      isFeed={opts.isFeed ?? false}
      activeItem=""
      tier={opts.tier}
      sources={sources}
      onNavigateHome={onNavigateHome}
      onNavigateToMarketplace={onNavigateToMarketplace}
      onNavigateToSettings={() => {}}
      onNavigateToTicker={() => {}}
      onNavigateToAccount={() => {}}
      onNavigateToSupport={() => {}}
      onSelectItem={() => {}}
      onConfigureItem={() => {}}
      onInfoItem={() => {}}
      onToggleItemTicker={() => {}}
      onRemoveItem={() => {}}
    />,
  );
  return { onNavigateToMarketplace, onNavigateHome };
}

describe("Sidebar slot chip", () => {
  it("shows used/cap and the add affordance below the cap", () => {
    renderSidebar({ tier: "free", sourceCount: 2 });
    expect(
      screen.getByRole("button", {
        name: "2 of 3 slots used — add a source",
      }),
    ).toBeInTheDocument();
  });

  it("flips to the upgrade affordance at cap", () => {
    renderSidebar({ tier: "free", sourceCount: 3 });
    expect(
      screen.getByRole("button", {
        name: "All 3 slots used — get more slots",
      }),
    ).toBeInTheDocument();
  });

  it("shows a plain add affordance on unlimited tiers", () => {
    renderSidebar({ tier: "uplink_ultimate", sourceCount: 5 });
    expect(
      screen.getByRole("button", { name: "Add a source" }),
    ).toBeInTheDocument();
  });

  it("navigates to the catalog on click", () => {
    const { onNavigateToMarketplace } = renderSidebar({
      tier: "free",
      sourceCount: 2,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "2 of 3 slots used — add a source",
      }),
    );
    expect(onNavigateToMarketplace).toHaveBeenCalledOnce();
  });

  it("renders exactly one add affordance (no ghost rows, no top CTA)", () => {
    renderSidebar({ tier: "free", sourceCount: 1 });
    const addButtons = screen.queryAllByRole("button", {
      name: /add a source|add source|empty slot/i,
    });
    expect(addButtons).toHaveLength(1);
  });
});

describe("Sidebar home row", () => {
  it("is present even with zero sources", () => {
    renderSidebar({ tier: "free", sourceCount: 0 });
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
  });

  it("navigates home on click", () => {
    const { onNavigateHome } = renderSidebar({ tier: "free", sourceCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onNavigateHome).toHaveBeenCalledOnce();
  });

  it("is marked current on the feed route", () => {
    renderSidebar({ tier: "free", sourceCount: 1, isFeed: true });
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("is not marked current off the feed route", () => {
    renderSidebar({ tier: "free", sourceCount: 1, isFeed: false });
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
