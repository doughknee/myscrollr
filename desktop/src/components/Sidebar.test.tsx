/**
 * Sidebar ghost slots — unused widget slots render as dashed
 * "Empty slot" rows (≤3, none for unlimited tiers) that navigate to
 * the catalog. See REL-24.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrendingUp } from "lucide-react";
import Sidebar from "./Sidebar";
import type { SubscriptionTier } from "../auth";

function renderSidebar(opts: { tier: SubscriptionTier; sourceCount: number }) {
  const onNavigateToMarketplace = vi.fn();
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
      activeItem=""
      tier={opts.tier}
      sources={sources}
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
  return { onNavigateToMarketplace };
}

const ghostRows = () =>
  screen.queryAllByRole("button", { name: /empty slot/i });

describe("Sidebar ghost slots", () => {
  it("renders one ghost per unused slot (free tier, 2 of 3 used)", () => {
    renderSidebar({ tier: "free", sourceCount: 2 });
    expect(ghostRows()).toHaveLength(1);
  });

  it("renders no ghosts when every slot is used", () => {
    renderSidebar({ tier: "free", sourceCount: 3 });
    expect(ghostRows()).toHaveLength(0);
  });

  it("caps ghosts at 3 for larger tiers", () => {
    renderSidebar({ tier: "uplink_pro", sourceCount: 2 }); // 10 free slots
    expect(ghostRows()).toHaveLength(3);
  });

  it("renders no ghosts on unlimited tiers", () => {
    renderSidebar({ tier: "uplink_ultimate", sourceCount: 0 });
    expect(ghostRows()).toHaveLength(0);
  });

  it("ghost click navigates to the catalog", () => {
    const { onNavigateToMarketplace } = renderSidebar({
      tier: "free",
      sourceCount: 2,
    });
    fireEvent.click(ghostRows()[0]);
    expect(onNavigateToMarketplace).toHaveBeenCalledOnce();
  });
});
