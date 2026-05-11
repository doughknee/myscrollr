/**
 * SourcePageLayout — page chassis for channel and widget routes.
 *
 * Renders through the universal `PageLayout`. Source pages no longer
 * have a visible tab band — Feed is the single visible page. All
 * secondary actions (Configure, Display preferences, Remove) live in
 * a contextual menu opened by the "Options" pill button in the
 * TopBar. The breadcrumb segments are plain navigation text — the
 * pill is the single, explicit menu trigger.
 *
 * The /feed, /configuration, and /display routes all still exist for
 * direct deeplinks, tray actions, and the Catalog "Open" → feed flow.
 *
 * IA refactor 2026-05-09 — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 * Walkthrough discoverability fix 2026-05-11.
 */
import { useState } from "react";
import { Settings as SettingsIcon, SlidersHorizontal, Tv, Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import PageLayout from "./layout/PageLayout";
import { type OverflowMenuItem } from "./OverflowMenu";

// Note: "Manage on ticker" used to live in this menu but was removed in
// the 2026-05-11 walkthrough fix — it navigated users away from the
// source they were configuring to a global Settings panel, which testers
// found jarring. Ticker configuration is still reachable from the main
// Settings route. See AGENTS.md or the PR description for context.

// ── Shared tab constants ────────────────────────────────────────
//
// SourceTab is part of the URL contract — channels can be deeplinked
// to /channel/$type/feed, /configuration, or /display. We don't render
// a visible tab band; users navigate via the OverflowMenu in the
// TopBar entityAction slot.

export const VALID_TABS = ["feed", "configuration", "display"] as const;
export type SourceTab = (typeof VALID_TABS)[number];

/** Parse a raw tab parameter into a valid SourceTab.
 *  Falls back to "feed" for anything unrecognised. */
export function parseSourceTab(rawTab: string): SourceTab {
  return (VALID_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as SourceTab)
    : "feed";
}

/** Fallback for when a source (channel or widget) is not found. */
export function SourceNotFound({
  kind,
  name,
}: {
  kind: "Channel" | "Widget";
  name: string;
}) {
  return (
    <PageLayout title={kind + " not found"} width="narrow">
      <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto gap-3 py-12">
        <p className="text-sm text-fg-3">
          The {kind.toLowerCase()} &ldquo;{name}&rdquo; is not installed.
        </p>
      </div>
    </PageLayout>
  );
}

// ── Layout ──────────────────────────────────────────────────────

interface SourcePageLayoutProps {
  name: string;
  /** Optional 1-line description rendered next to the name. */
  description?: string;
  /** Current tab — "feed" or "configuration". */
  activeTab: SourceTab;
  /** Navigate to a different tab (used by menu items + Configure CTAs). */
  onTabChange: (tab: SourceTab) => void;
  /** Click handler for the parent breadcrumb in the TopBar
   *  (typically navigates back to /feed). */
  onBack: () => void;
  children: React.ReactNode;

  /** Source-level remove action. */
  onRemove?: () => void;
  /** "channel" triggers a ConfirmDialog before removal; "widget" removes immediately. */
  sourceKind?: "channel" | "widget";
  /** Whether this source has display preferences. Channels: true.
   *  Widgets: their display options live alongside config; we don't
   *  surface a separate "Display" menu item for them. */
  hasDisplayPreferences?: boolean;
}

export default function SourcePageLayout({
  name,
  description,
  activeTab,
  onTabChange,
  onBack,
  children,
  onRemove,
  sourceKind,
  hasDisplayPreferences = false,
}: SourcePageLayoutProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  function handleRemove() {
    if (sourceKind === "channel") {
      setConfirmRemove(true);
    } else {
      onRemove?.();
    }
  }

  // Build the menu items list. Order is intentional: when away from
  // Feed, "Back to feed" goes first so the menu always offers a
  // canonical way out. Then Configure → Display, a divider, then
  // destructive Remove at the bottom. (Pre-2026-05-11 this also
  // included "Manage on ticker" — removed because it navigated users
  // away from the source page to global ticker settings, which
  // confused testers.)
  const menuItems: OverflowMenuItem[] = [];

  // Always offer "Back to feed" when not on the feed already. This
  // is the canonical way to escape Configure / Display.
  if (activeTab !== "feed") {
    menuItems.push({
      key: "feed",
      label: "Back to feed",
      icon: Tv,
      onSelect: () => onTabChange("feed"),
    });
    menuItems.push({ key: "div-back", divider: true });
  }

  // Configure — always present except when already there.
  if (activeTab !== "configuration") {
    menuItems.push({
      key: "configure",
      label: sourceKind === "widget" ? "Configure widget" : "Configure source",
      hint:
        sourceKind === "widget"
          ? "Pick what to track and how it renders"
          : "Pick what to track",
      icon: SettingsIcon,
      onSelect: () => onTabChange("configuration"),
    });
  }

  // Display preferences — channels only, on its own /display route.
  // Hidden when already on Display.
  if (hasDisplayPreferences && activeTab !== "display") {
    menuItems.push({
      key: "display",
      label: "Display preferences",
      hint: "Choose what shows on Home and the ticker",
      icon: SlidersHorizontal,
      onSelect: () => onTabChange("display"),
    });
  }

  if (onRemove) {
    menuItems.push({ key: "div-1", divider: true });
    menuItems.push({
      key: "remove",
      label: `Remove ${name}`,
      icon: Trash2,
      destructive: true,
      onSelect: handleRemove,
    });
  }

  // Feed view is data-dense (grids of trade cards, score cards, RSS
  // articles, etc.) and should render flush to the content area at
  // full width. Configure / Display are forms — they keep the
  // narrow-column padded layout for legibility.
  const isFeed = activeTab === "feed";

  return (
    <>
      <PageLayout
        title={name}
        subtitle={description}
        parentLabel="Home"
        onParentClick={onBack}
        // When on a sub-route (Configure or Display), clicking the
        // source name in the breadcrumb returns to the source's Feed
        // view. On Feed itself the title is plain text.
        onTitleClick={
          activeTab !== "feed" ? () => onTabChange("feed") : undefined
        }
        width={isFeed ? "wide" : "narrow"}
        // Configure tab gets a fill-height shell so SymbolManager (and
        // future configure surfaces in other channels) can scroll its
        // own list within a fixed pane instead of growing the page.
        fillHeight={activeTab === "configuration"}
        // Feed tab renders flush to the viewport edges (no PageLayout
        // padding / max-width clamp). The feed's own components own
        // their padding. Configure / Display keep the default padded
        // narrow column.
        noContentPadding={isFeed}
        // Source pages use the "Options" pill in the TopBar as the
        // sole menu trigger; the breadcrumb is plain navigation text.
        // Walkthrough fix 2026-05-11 — testers preferred the explicit
        // pill over the hidden breadcrumb dropdown.
        menuItems={menuItems}
        menuLabel={`${name} options`}
      >
        {children}
      </PageLayout>

      {/* Channel removal confirmation. Widgets remove immediately
          via the useUndoableAction toast (see widget route). */}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${name}?`}
        description={`This will delete your ${name} configuration and remove it from the dashboard. You can re-add it from the Catalog.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove?.();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}
