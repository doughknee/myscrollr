/**
 * Sidebar — collapsible navigation rail.
 *
 * The rail is split into three labeled groups so a long list of
 * unrelated nav items doesn't read as a single undifferentiated
 * column:
 *
 *   ┌──────────┐
 *   │ SOURCES  │
 *   │ Finance  │
 *   │ Sports   │
 *   │ Weather  │
 *   ├──────────┤
 *   │ WORKSPACE│
 *   │ + Add    │  ← drilled into Catalog
 *   │ Settings │
 *   │ Ticker   │
 *   ├──────────┤
 *   │ ACCOUNT  │
 *   │ Account  │
 *   │ Support  │
 *   ├──────────┤
 *   │ Collapse │
 *   └──────────┘
 *
 * Home navigation lives on the Scrollr brand mark in the TopBar;
 * connection/ticker status lives in the TopBar too. The sidebar
 * stays minimal and navigational.
 *
 * Collapses to a 48px icon-only rail with tooltips. Group headings
 * are hidden in the collapsed state (they'd just be empty rows) but
 * the divider lines stay so the grouping survives visually.
 */
import { useState } from "react";
import {
  ArrowUpRight,
  Info,
  LifeBuoy,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RadioTower,
  Settings,
  Settings2,
  Trash2,
  UserCircle,
} from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import Tooltip from "./Tooltip";
import ContextMenu from "./ContextMenu";
import type { ChannelManifest, WidgetManifest } from "../types";
import { loadPref, savePref } from "../preferences";

// ── Props ───────────────────────────────────────────────────────

export interface SidebarSource {
  id: string;
  name: string;
  hex: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kind: "channel" | "widget";
  /** Whether this source currently has chips on the ticker — drives
   *  the context menu's Show/Hide label (v1.1.2). */
  onTicker: boolean;
}

interface SidebarProps {
  /** Whether the settings page is active. */
  isSettings: boolean;
  /** Whether the ticker settings page is active. */
  isTicker: boolean;
  /** Whether the account page is active. */
  isAccount: boolean;
  /** Whether the catalog page is active. Drives the "+ Add source"
   *  button's active state. */
  isMarketplace: boolean;
  /** Whether the support page is active. */
  isSupport: boolean;
  /** Currently active channel or widget ID (for highlighting). */
  activeItem: string;

  /** Resolved enabled-source manifest data, in canonical order. */
  sources: SidebarSource[];

  /** Navigate to the catalog page (used by "+ Add source"). */
  onNavigateToMarketplace: () => void;
  /** Navigate to the settings page. */
  onNavigateToSettings: () => void;
  /** Navigate to the ticker page. */
  onNavigateToTicker: () => void;
  /** Navigate to the account page. */
  onNavigateToAccount: () => void;
  /** Navigate to the support page. */
  onNavigateToSupport: () => void;
  /** Navigate to a specific source (channel or widget) feed. */
  onSelectItem: (id: string, kind: "channel" | "widget") => void;

  // ── Context-menu actions (v1.1.2: right-click a source row) ──
  /** Open the source's Configure tab. */
  onConfigureItem: (id: string, kind: "channel" | "widget") => void;
  /** Open the widget's catalog info page. */
  onInfoItem: (id: string) => void;
  /** Toggle the source's presence on the ticker. */
  onToggleItemTicker: (source: SidebarSource) => void;
  /** Remove the widget (frees its slot). */
  onRemoveItem: (source: SidebarSource) => void;
}

// ── Component ───────────────────────────────────────────────────

export default function Sidebar({
  isSettings,
  isTicker,
  isAccount,
  isMarketplace,
  isSupport,
  activeItem,
  sources,
  onNavigateToMarketplace,
  onNavigateToSettings,
  onNavigateToTicker,
  onNavigateToAccount,
  onNavigateToSupport,
  onSelectItem,
  onConfigureItem,
  onInfoItem,
  onToggleItemTicker,
  onRemoveItem,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() =>
    loadPref("sidebarCollapsed", false),
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

  return (
    <aside
      className={clsx(
        "flex flex-col shrink-0 h-full overflow-hidden select-none transition-[width] duration-200 ease-out",
        collapsed ? "w-[48px]" : "w-[200px]",
      )}
    >
      {/* ── Sources ─────────────────────────────────────────────
          The user's enabled channels and widgets in canonical
          order. Scrollable when long. */}
      <NavGroup
        ariaLabel="Sources"
        heading="Sources"
        collapsed={collapsed}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {sources.length > 0 ? (
          sources.map((source) => (
            <NavItem
              key={source.id}
              icon={
                <span style={{ color: source.hex }}>
                  <source.icon size={15} />
                </span>
              }
              label={source.name}
              active={activeItem === source.id}
              collapsed={collapsed}
              onClick={() => onSelectItem(source.id, source.kind)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ source, x: e.clientX, y: e.clientY });
              }}
            />
          ))
        ) : (
          !collapsed && (
            <p className="px-2.5 text-ui-meta leading-snug">
              No sources yet. Use{" "}
              <span className="font-medium text-accent">Add source</span>{" "}
              to get started.
            </p>
          )
        )}
      </NavGroup>

      {/* ── Workspace ─────────────────────────────────────────── */}
      <NavGroup
        ariaLabel="Workspace"
        heading="Workspace"
        collapsed={collapsed}
      >
        <NavItem
          icon={<Plus size={15} strokeWidth={2.5} />}
          label="Add source"
          active={isMarketplace}
          collapsed={collapsed}
          accent
          onClick={onNavigateToMarketplace}
        />
        <NavItem
          icon={<Settings size={15} />}
          label="Settings"
          active={isSettings}
          collapsed={collapsed}
          onClick={onNavigateToSettings}
        />
        <NavItem
          icon={<RadioTower size={15} />}
          label="Ticker"
          active={isTicker}
          collapsed={collapsed}
          onClick={onNavigateToTicker}
        />
      </NavGroup>

      {/* ── Account ───────────────────────────────────────────── */}
      <NavGroup
        ariaLabel="Account"
        heading="Account"
        collapsed={collapsed}
      >
        <NavItem
          icon={<UserCircle size={15} />}
          label="Account"
          active={isAccount}
          collapsed={collapsed}
          onClick={onNavigateToAccount}
        />
        <NavItem
          icon={<LifeBuoy size={15} />}
          label="Support"
          active={isSupport}
          collapsed={collapsed}
          onClick={onNavigateToSupport}
        />
      </NavGroup>

      {/* ── Collapse toggle ───────────────────────────────────────
          Lives outside the three labeled groups because it's chrome,
          not navigation. Connection status + ticker status live in
          the TopBar — see components/TopBar.tsx. */}
      <div
        className={clsx(
          "shrink-0 py-2",
          collapsed ? "px-1" : "px-2",
        )}
      >
        <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={clsx(
              "flex items-center w-full rounded-lg text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
              "transition-all duration-150 active:scale-[0.97]",
              collapsed
                ? "justify-center py-1.5"
                : "gap-2.5 px-2.5 py-1.5",
            )}
          >
            <span className="shrink-0 flex items-center justify-center w-5 h-5">
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </span>
            {!collapsed && (
              <span className="text-ui-meta font-medium">Collapse</span>
            )}
          </button>
        </Tooltip>
      </div>

      {/* ── Source context menu (v1.1.2) ───────────────────────
          Everything you can do to a widget without leaving the rail:
          open, configure, ticker visibility, its catalog page, and
          remove. Actions resolve in the shell layer — the same paths
          the info page and ticker settings use. */}
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                {
                  key: "open",
                  label: "Open",
                  icon: ArrowUpRight,
                  onSelect: () => onSelectItem(menu.source.id, menu.source.kind),
                },
                {
                  key: "configure",
                  label: "Configure",
                  icon: Settings2,
                  onSelect: () => onConfigureItem(menu.source.id, menu.source.kind),
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
                {
                  key: "remove",
                  label: "Remove",
                  icon: Trash2,
                  destructive: true,
                  dividerBefore: true,
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
      {!collapsed && (
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
  accent = false,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed?: boolean;
  /** Accent variant for CTA-like items (currently "Add source"). */
  accent?: boolean;
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
          active
            ? accent
              ? "bg-accent/15 text-accent"
              : "text-fg"
            : accent
              ? "text-accent/85 hover:bg-accent/10 hover:text-accent"
              : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
        )}
      >
        {/* Active indicator — filled pill behind the row. layoutId
            makes it slide between nav items when the active page
            changes (same pattern as the TopBar tab pill; z-0 fill +
            z-10 content so labels stay above it mid-flight). The
            accent CTA carries its own active treatment so the pill
            is suppressed there to avoid double-emphasis. */}
        {active && !accent && (
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
