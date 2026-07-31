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
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

function renderSidebar(opts: {
  tier: SubscriptionTier;
  sourceCount: number;
  isFeed?: boolean;
  isUpdates?: boolean;
  isStatus?: boolean;
  collapsed?: boolean;
  health?: DeliveryHealth;
}) {
  const onNavigateToMarketplace = vi.fn();
  const onNavigateHome = vi.fn();
  const onNavigateToReleases = vi.fn();
  const onNavigateToStatus = vi.fn();
  const onMoveItem = vi.fn();
  const sources = Array.from({ length: opts.sourceCount }, (_, i) => ({
    id: `src-${i}`,
    name: `Source ${i}`,
    hex: "#34d399",
    icon: TrendingUp,
    kind: "data" as const,
    onTicker: false,
  }));
  const { container } = render(
    <div id="app-shell">
      <Sidebar
        isCustomize={false}
        isAccount={false}
        isMarketplace={false}
        isSupport={false}
        isUpdates={opts.isUpdates ?? false}
        collapsed={opts.collapsed ?? false}
        isStatus={opts.isStatus ?? false}
        isFeed={opts.isFeed ?? false}
        activeItem=""
        tier={opts.tier}
        health={
          opts.health ?? {
            state: "live",
            ageMs: 0,
            label: "Live",
            description: "Connected",
          }
        }
        sources={sources}
        onNavigateHome={onNavigateHome}
        onNavigateToMarketplace={onNavigateToMarketplace}
        onNavigateToCustomize={() => {}}
        onNavigateToAccount={() => {}}
        onNavigateToSupport={() => {}}
        onNavigateToReleases={onNavigateToReleases}
        onNavigateToStatus={onNavigateToStatus}
        onSelectItem={() => {}}
        onInfoItem={() => {}}
        onToggleItemTicker={() => {}}
        onMoveItem={onMoveItem}
        onRemoveItem={() => {}}
      />
    </div>,
  );
  return {
    container,
    onNavigateToMarketplace,
    onNavigateHome,
    onNavigateToReleases,
    onNavigateToStatus,
    onMoveItem,
  };
}

describe("Sidebar slot chip", () => {
  it("shows used/cap and the add affordance below the cap", () => {
    renderSidebar({ tier: "free", sourceCount: 2 });
    expect(
      screen.getByRole("button", {
        name: "2 of 3 slots used — add a widget",
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
      screen.getByRole("button", { name: "Add a widget" }),
    ).toBeInTheDocument();
  });

  it("navigates to the catalog on click", () => {
    const { onNavigateToMarketplace } = renderSidebar({
      tier: "free",
      sourceCount: 2,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "2 of 3 slots used — add a widget",
      }),
    );
    expect(onNavigateToMarketplace).toHaveBeenCalledOnce();
  });

  it("renders exactly one add affordance (no ghost rows, no top CTA)", () => {
    renderSidebar({ tier: "free", sourceCount: 1 });
    const addButtons = screen.queryAllByRole("button", {
      name: /add a widget|add source|empty slot/i,
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

  it("keeps the moving indicator outside the scrollable widget list", () => {
    const { container } = renderSidebar({
      tier: "free",
      sourceCount: 1,
      isFeed: true,
    });
    const aside = container.querySelector("aside");
    const indicator = Array.from(aside?.children ?? []).find(
      (child) => child.getAttribute("aria-hidden") === "true",
    );

    expect(indicator).toBeInTheDocument();
  });

  it("is not marked current off the feed route", () => {
    renderSidebar({ tier: "free", sourceCount: 1, isFeed: false });
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("Sidebar account menu", () => {
  it("keeps connection status visible and accessible on the collapsed chip", () => {
    renderSidebar({ tier: "free", sourceCount: 0 });
    expect(
      screen.getByRole("button", {
        name: "Account and app. Connection status: Live.",
      }),
    ).toBeInTheDocument();
  });

  it("opens Status and What's new destinations", async () => {
    const { onNavigateToReleases, onNavigateToStatus } = renderSidebar({
      tier: "free",
      sourceCount: 0,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Account and app. Connection status: Live.",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /Status/ }));
    expect(onNavigateToStatus).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Account and app. Connection status: Live.",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "What's new" }),
    );
    expect(onNavigateToReleases).toHaveBeenCalledOnce();
    // Two full open/animate/query cycles on an animated menu. Comfortably
    // under a second on an idle machine, but it was already the slowest
    // test in the suite and would intermittently blow the 5s default once
    // enough files ran in parallel — a timeout, never an assertion
    // failure. The budget is the fix; the test itself is sound.
  }, 20_000);

  it("marks Status as an active account destination", () => {
    renderSidebar({ tier: "free", sourceCount: 0, isStatus: true });
    expect(
      screen.getByRole("button", {
        name: "Account and app. Connection status: Live.",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows the tier without the redundant plan suffix", () => {
    // Rendered expanded rather than clicking a toggle: the collapse
    // button moved to the TopBar, so the rail no longer owns that
    // state. Only the chip's caption is under test here.
    renderSidebar({ tier: "super_user", sourceCount: 0, collapsed: false });
    expect(screen.getByText("Super User")).toBeInTheDocument();
    expect(screen.queryByText("Super User plan")).not.toBeInTheDocument();
  });
});

describe("Sidebar widget ordering", () => {
  it("moves widgets from their right-click menu and guards the list edges", async () => {
    const { onMoveItem } = renderSidebar({ tier: "free", sourceCount: 3 });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Source 1" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move up" }));
    expect(onMoveItem).toHaveBeenCalledWith("src-1", "up");

    fireEvent.contextMenu(screen.getByRole("button", { name: "Source 0" }));
    expect(await screen.findByRole("menuitem", { name: "Move up" })).toBeDisabled();
  });
});
