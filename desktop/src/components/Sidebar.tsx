/**
 * Sidebar — collapsible navigation rail.
 *
 *   ┌────────────┐
 *   │ SOURCES    │
 *   │ Finance    │
 *   │ Sports     │
 *   │ + 2/3      │  ← slot chip: add-source CTA + cap meter in one
 *   │    ⋮       │
 *   │ [Account ▾]│⇤│  ← footer chip: Account/Support menu
 *   └────────────┘      menu + collapse toggle
 *
 * Home navigation lives on the Scrollr brand mark in the TopBar;
 * connection/ticker status lives in the TopBar too. The sidebar
 * stays minimal: sources are the rail, everything app-level hides
 * behind the footer account chip.
 *
 * Defaults to the 48px icon-only rail (tooltips carry labels; the
 * slot chip shows cap dots) — a slot-capped source list doesn't fill
 * a 200px panel. Expanding is one click and the pref persists.
 */
import { useState, forwardRef } from "react";
import type { ButtonHTMLAttributes, Ref } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Home,
  Info,
  LifeBuoy,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RadioTower,
  SlidersHorizontal,
  Trash2,
  UserCircle,
} from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import Tooltip from "./Tooltip";
import OverflowMenu from "./OverflowMenu";
import type { DataWidgetManifest, WidgetManifest } from "../types";
import { loadPref, savePref } from "../preferences";
import { TIER_LABELS, getUserIdentity } from "../auth";
import type { SubscriptionTier } from "../auth";
import { getMaxWidgets } from "../tierLimits";

// ── Props ───────────────────────────────────────────────────────

export interface SidebarSource {
  id: string;
  name: string;
  hex: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kind: "data" | "utility";
  /** Whether this source currently has chips on the ticker — drives
   *  the context menu's Show/Hide label (v1.1.2). */
  onTicker: boolean;
  /** Real brand mark (same URL the Catalog cards show). Rendered in
   *  place of the colored Lucide icon, which stays as the fallback. */
  logoUrl?: string;
  /** Render the logo on a light tile (transparent/dark marks). */
  logoLight?: boolean;
}

/** Source row glyph: the brand mark when one exists (matching the
 *  Catalog cards); otherwise an app-icon TILE — the widget's glyph on
 *  a gradient of its brand hex — so every source reads as a distinct
 *  logo, not a bare icon. The tile is also the onError fallback
 *  (offline, CDN blank). */
function SourceGlyph({ source }: { source: SidebarSource }) {
  const [failed, setFailed] = useState(false);
  if (!source.logoUrl || failed) {
    return (
      <span
        className="flex h-4 w-4 items-center justify-center rounded-[4px] text-white"
        style={{
          background: `linear-gradient(135deg, ${source.hex} 0%, ${source.hex}b8 100%)`,
        }}
      >
        <source.icon size={11} />
      </span>
    );
  }
  return (
    <img
      src={source.logoUrl}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      className={clsx(
        "h-4 w-4 rounded-[4px] object-contain",
        source.logoLight && "bg-white p-px",
      )}
    />
  );
}

interface SidebarProps {
  /** Whether the Customize page (merged Settings + Ticker) is active. */
  isCustomize: boolean;
  /** Whether the account page is active. */
  isAccount: boolean;
  /** Whether the catalog page is active. Drives the "+ Add source"
   *  button's active state. */
  isMarketplace: boolean;
  /** Whether the support page is active. */
  isSupport: boolean;
  /** Whether the home feed is active. Drives the pinned Home row. */
  isFeed: boolean;
  /** Currently active widget or widget ID (for highlighting). */
  activeItem: string;
  /** Subscription tier — shown on the footer account chip. */
  tier: SubscriptionTier;

  /** Resolved enabled-source manifest data, in canonical order. */
  sources: SidebarSource[];

  /** Navigate to the home feed (the pinned Home row). */
  onNavigateHome: () => void;
  /** Navigate to the catalog page (used by "+ Add source"). */
  onNavigateToMarketplace: () => void;
  /** Navigate to the Customize page (merged Settings + Ticker). */
  onNavigateToCustomize: () => void;
  /** Navigate to the account page. */
  onNavigateToAccount: () => void;
  /** Navigate to the support page. */
  onNavigateToSupport: () => void;
  /** Navigate to a specific source (widget or widget) feed. */
  onSelectItem: (id: string) => void;

  // ── Context-menu actions (v1.1.2: right-click a source row) ──
  /** Open the widget's catalog info page. */
  onInfoItem: (id: string) => void;
  /** Toggle the source's presence on the ticker. */
  onToggleItemTicker: (source: SidebarSource) => void;
  /** Remove the widget (frees its slot). */
  onRemoveItem: (source: SidebarSource) => void;
}

// ── Component ───────────────────────────────────────────────────

export default function Sidebar({
  isCustomize,
  isAccount,
  isMarketplace,
  isSupport,
  isFeed,
  activeItem,
  tier,
  sources,
  onNavigateHome,
  onNavigateToMarketplace,
  onNavigateToCustomize,
  onNavigateToAccount,
  onNavigateToSupport,
  onSelectItem,
  onInfoItem,
  onToggleItemTicker,
  onRemoveItem,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() =>
    // Collapsed is the default: with a slot-capped source list the
    // expanded rail is mostly void. Users who expand keep their pref.
    loadPref("sidebarCollapsed", true),
  );
  // Right-click menu on a source row (v1.1.2). One menu at a time,
  // anchored at the pointer.
  const [menu, setMenu] = useState<{
    source: SidebarSource;
    x: number;
    y: number;
  } | null>(null);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    savePref("sidebarCollapsed", next);
  }

  const slotCap = getMaxWidgets(tier);

  return (
    <aside
      className={clsx(
        "flex flex-col shrink-0 h-full overflow-hidden select-none transition-[width] duration-200 ease-out",
        collapsed ? "w-[48px]" : "w-[200px]",
      )}
    >
      {/* ── App destinations — Home + Customize above the sources,
          Claude-desktop style: the rail leads with where you GO, then
          lists what you FOLLOW. */}
      <NavGroup ariaLabel="App" heading="" collapsed={collapsed}>
        <NavItem
          icon={<Home size={15} />}
          label="Home"
          active={isFeed}
          collapsed={collapsed}
          onClick={onNavigateHome}
        />
        <NavItem
          icon={<SlidersHorizontal size={15} />}
          label="Customize"
          active={isCustomize}
          collapsed={collapsed}
          onClick={onNavigateToCustomize}
        />
        {/* Add-widget affordance rides with the app destinations —
            adding is something you DO, not something you follow. */}
        <SlotChip
          collapsed={collapsed}
          used={sources.length}
          cap={slotCap}
          active={isMarketplace}
          onClick={onNavigateToMarketplace}
        />
      </NavGroup>

      {/* ── Sources ─────────────────────────────────────────────
          The user's enabled widgets and widgets in canonical
          order. Scrollable when long. */}
      <NavGroup
        ariaLabel="Widgets"
        heading="Widgets"
        collapsed={collapsed}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {sources.map((source) => (
          <NavItem
            key={source.id}
            icon={<SourceGlyph source={source} />}
            label={source.name}
            active={activeItem === source.id}
            collapsed={collapsed}
            onClick={() => onSelectItem(source.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ source, x: e.clientX, y: e.clientY });
            }}
          />
        ))}

      </NavGroup>

      {/* ── Workspace ─────────────────────────────────────────── */}
      {/* ── Footer: account chip + collapse ─────────────────────
          Account + Support live behind one chip menu — Customize is
          a top-level rail item, and the sources own the rows. */}
      <div
        className={clsx(
          "shrink-0 py-2",
          collapsed
            ? "px-1 flex flex-col items-stretch gap-1"
            : "px-2 flex items-center gap-1",
        )}
      >
        <OverflowMenu
          placement={collapsed ? "right-end" : "top-start"}
          triggerLabel="Account & app"
          trigger={
            <AccountChip
              collapsed={collapsed}
              tierLabel={TIER_LABELS[tier]}
              active={isAccount || isSupport}
            />
          }
          items={[
            {
              key: "account",
              label: "Account",
              icon: UserCircle,
              onSelect: onNavigateToAccount,
            },
            {
              key: "support",
              label: "Support",
              icon: LifeBuoy,
              onSelect: onNavigateToSupport,
            },
          ]}
        />
        <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={clsx(
              "flex items-center justify-center shrink-0 rounded-lg text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
              "transition-all duration-150 active:scale-[0.97]",
              collapsed ? "w-full py-1.5" : "w-7 h-7",
            )}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </Tooltip>
      </div>

      {/* ── Source context menu (v1.1.2) ───────────────────────
          Everything you can do to a widget without leaving the rail:
          open, configure, ticker visibility, its catalog page, and
          remove. Actions resolve in the shell layer — the same paths
          the info page and ticker settings use. */}
      <OverflowMenu
        anchorPoint={menu && { x: menu.x, y: menu.y }}
        placement="bottom-start"
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                {
                  key: "open",
                  label: "Open",
                  icon: ArrowUpRight,
                  onSelect: () => onSelectItem(menu.source.id),
                },
                {
                  key: "ticker",
                  label: menu.source.onTicker
                    ? "Hide from ticker"
                    : "Show on ticker",
                  icon: RadioTower,
                  onSelect: () => onToggleItemTicker(menu.source),
                },
                {
                  key: "info",
                  label: "Widget page",
                  icon: Info,
                  onSelect: () => onInfoItem(menu.source.id),
                },
                { key: "remove-divider", divider: true },
                {
                  key: "remove",
                  label: "Remove",
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => onRemoveItem(menu.source),
                },
              ]
            : []
        }
      />
    </aside>
  );
}

// ── Nav group ───────────────────────────────────────────────────
// A labeled section of nav items. Hides the heading when collapsed
// (a single-character label looks like a glyph). Groups separate by
// whitespace + headings alone — no divider hairlines on the frame.
// Sources is the only group that scrolls — the rest stay shrink-0 so
// they always sit at their natural size.

function NavGroup({
  ariaLabel,
  heading,
  collapsed,
  className,
  children,
}: {
  ariaLabel: string;
  heading: string;
  collapsed: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={clsx(
        "shrink-0 py-2 space-y-0.5",
        collapsed ? "px-1" : "px-2",
        className,
      )}
    >
      {!collapsed && heading && (
        <h2 className="px-2.5 mb-1 text-ui-section">{heading}</h2>
      )}
      {children}
    </nav>
  );
}

// ── Nav item ────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed?: boolean;
  onClick: () => void;
  /** Right-click handler — source rows open their context menu. */
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <Tooltip content={collapsed ? label : undefined} side="right">
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={clsx(
          "relative flex items-center w-full rounded-lg font-medium",
          "transition-all duration-150 active:scale-[0.97]",
          collapsed
            ? "justify-center py-1.5 px-0"
            : "gap-2.5 px-2.5 py-1.5 text-ui-body",
          active ? "text-fg" : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
        )}
      >
        {/* Active indicator — filled pill behind the row. layoutId
            makes it slide between nav items when the active page
            changes (same pattern as the TopBar tab pill; z-0 fill +
            z-10 content so labels stay above it mid-flight). */}
        {active && (
          <motion.span
            layoutId="sidebar-active-indicator"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute inset-0 z-0 rounded-lg bg-accent/10"
          />
        )}
        <span className="relative z-10 shrink-0 flex items-center justify-center w-5 h-5">
          {icon}
        </span>
        {!collapsed && <span className="relative z-10 truncate">{label}</span>}
      </button>
    </Tooltip>
  );
}

// ── Slot chip ───────────────────────────────────────────────────
// The single add-source affordance, doubling as the slot meter.
// Collapsed: a `+` with cap dots beneath (●●○ — only for small caps,
// dots don't scale past 6). Expanded: "+ Add source · 2/3". At cap
// it flips to the upgrade affordance; unlimited tiers get a plain +.
// Either way it lands on the catalog, which handles the upsell.

function SlotChip({
  collapsed,
  used,
  cap,
  active,
  onClick,
}: {
  collapsed: boolean;
  used: number;
  cap: number;
  active: boolean;
  onClick: () => void;
}) {
  const finite = Number.isFinite(cap);
  const atCap = finite && used >= cap;
  const showDots = collapsed && finite && cap <= 6;

  const label = !finite
    ? "Add a widget"
    : atCap
      ? `All ${cap} slots used — get more slots`
      : `${used} of ${cap} slots used — add a widget`;

  return (
    <Tooltip content={collapsed ? label : undefined} side="right">
      <button
        onClick={onClick}
        aria-label={label}
        className={clsx(
          "relative flex items-center w-full rounded-lg font-medium",
          "transition-all duration-150 active:scale-[0.97]",
          collapsed
            ? "justify-center py-1.5 px-0"
            : "gap-2.5 px-2.5 py-1.5 text-ui-body",
          active
            ? "text-accent"
            : "text-accent/85 hover:bg-accent/10 hover:text-accent",
        )}
      >
        {/* Same shared active pill as NavItem — without it, navigating
            source → catalog unmounted the indicator with no destination
            (the highlight vanished instead of sliding here). The static
            bg is dropped while active so the pill is the one fill. */}
        {active && (
          <motion.span
            layoutId="sidebar-active-indicator"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute inset-0 z-0 rounded-lg bg-accent/15"
          />
        )}
        <span className="relative z-10 shrink-0 flex items-center justify-center w-5 h-5">
          <Plus size={15} strokeWidth={2.5} />
        </span>
        {/* Cap dots pinned to the bottom edge inside the padding, so
            the chip stays exactly NavItem-height. */}
        {showDots && (
          <span
            className="absolute bottom-[3px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-[3px]"
            aria-hidden
          >
            {Array.from({ length: cap }, (_, i) => (
              <span
                key={i}
                className={clsx(
                  "w-1 h-1 rounded-full",
                  i < used ? "bg-accent/70" : "bg-edge-2",
                )}
              />
            ))}
          </span>
        )}
        {!collapsed && (
          <>
            <span className="relative z-10 truncate">
              {atCap ? "Get more slots" : "Add widget"}
            </span>
            {finite && (
              <span className="relative z-10 ml-auto shrink-0 text-ui-meta text-fg-4">
                {used}/{cap}
              </span>
            )}
          </>
        )}
      </button>
    </Tooltip>
  );
}

// ── Account chip ────────────────────────────────────────────────
// Footer trigger for the app-level menu (Account/
// Support). floating-ui injects ref + aria handlers via cloneElement,
// so this is a forwardRef-compatible button (same pattern as the
// TopBar's MoreTabsTrigger). `active` marks that one of the menu's
// pages is currently open.

const AccountChip = forwardRef(function AccountChip(
  {
    collapsed,
    tierLabel,
    active,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    collapsed: boolean;
    tierLabel: string;
    active: boolean;
  },
  ref: Ref<HTMLButtonElement>,
) {
  const isOpen =
    props["aria-expanded"] === true || props["aria-expanded"] === "true";

  // Identity from the token claims — stable for the sidebar's
  // lifetime (it only renders authenticated). Claude-style two-line
  // chip: name on top, plan caption beneath.
  const { name, email } = getUserIdentity();
  const displayName = name || email?.split("@")[0] || "Account";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={clsx(
        "flex items-center rounded-lg min-w-0",
        "transition-all duration-150 active:scale-[0.97]",
        collapsed
          ? "w-full justify-center py-1.5"
          : "flex-1 gap-2 px-1.5 py-1",
        active || isOpen
          ? "bg-surface-hover"
          : "hover:bg-surface-hover",
      )}
    >
      {/* Initial avatar */}
      <span
        className={clsx(
          "shrink-0 flex items-center justify-center rounded-full",
          "bg-accent/15 text-accent text-ui-chip font-semibold",
          collapsed ? "w-6 h-6" : "w-7 h-7",
        )}
      >
        {initial}
      </span>
      {!collapsed && (
        <>
          <span className="flex flex-col items-start min-w-0 leading-tight">
            <span className="w-full truncate text-left text-ui-body font-medium text-fg-2">
              {displayName}
            </span>
            <span className="w-full truncate text-left text-ui-meta text-fg-4">
              {tierLabel} plan
            </span>
          </span>
          <ChevronDown
            size={11}
            className="ml-auto shrink-0 text-fg-4"
            style={{
              transition: "transform 300ms var(--ease-snap)",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </>
      )}
    </button>
  );
});
