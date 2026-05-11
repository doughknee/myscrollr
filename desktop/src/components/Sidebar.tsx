/**
 * Sidebar — collapsible source rail.
 *
 * Post-polish-pass the sidebar is just a list of the user's enabled
 * sources (channels + widgets). Home navigation lives on the Scrollr
 * brand mark in the TopBar; Catalog navigation lives in the "+ Add
 * source" button at the bottom of the source list. Settings + Support
 * stay in the footer.
 *
 * Layout:
 *   ┌──────────┐
 *   │ SOURCES  │
 *   │ Finance  │
 *   │ Sports   │
 *   │ Weather  │
 *   │          │
 *   │ + Add    │  ← drilled into Catalog
 *   ├──────────┤
 *   │ Settings │
 *   │ Support  │
 *   │ Collapse │
 *   └──────────┘
 *
 * Collapses to a 48px icon-only rail with tooltips.
 */
import { useState } from "react";
import { Settings, LifeBuoy, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import Tooltip from "./Tooltip";
import type { ChannelManifest, WidgetManifest } from "../types";
import { loadPref, savePref } from "../preferences";

// ── Props ───────────────────────────────────────────────────────

interface SidebarSource {
  id: string;
  name: string;
  hex: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kind: "channel" | "widget";
}

interface SidebarProps {
  /** Whether the settings page is active. */
  isSettings: boolean;
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
  /** Navigate to the support page. */
  onNavigateToSupport: () => void;
  /** Navigate to a specific source (channel or widget) feed. */
  onSelectItem: (id: string, kind: "channel" | "widget") => void;
}

// ── Component ───────────────────────────────────────────────────

export default function Sidebar({
  isSettings,
  isMarketplace,
  isSupport,
  activeItem,
  sources,
  onNavigateToMarketplace,
  onNavigateToSettings,
  onNavigateToSupport,
  onSelectItem,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() =>
    loadPref("sidebarCollapsed", false),
  );

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    savePref("sidebarCollapsed", next);
  }

  return (
    <aside
      className={clsx(
        "flex flex-col shrink-0 border-r border-edge bg-surface-2 h-full overflow-hidden select-none transition-[width] duration-200 ease-out",
        collapsed ? "w-[48px]" : "w-[200px]",
      )}
    >
      {/* Sources nav. Home is the Scrollr brand mark in the TopBar
          (clickable). Catalog is reached via the "+ Add source" button
          at the bottom of this list. So the sidebar is just sources. */}
      <nav
        aria-label="Sources"
        className={clsx(
          "flex-1 overflow-y-auto scrollbar-thin py-3",
          collapsed ? "px-1" : "px-2",
        )}
      >
        {!collapsed && (
          <h2 className="px-2.5 mb-2 text-ui-section">
            Sources
          </h2>
        )}

        {sources.length > 0 ? (
          <div className="space-y-0.5">
            {sources.map((source) => (
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
              />
            ))}
          </div>
        ) : (
          !collapsed && (
            <p className="px-2.5 text-ui-meta leading-snug">
              No sources yet. Tap{" "}
              <span className="font-medium text-accent">+ Add source</span>{" "}
              below to get started.
            </p>
          )
        )}

        {/* Add source — sits below the source list. Drilled into the
            Catalog. Spec-aligned: '+ Add' is grouped with the
            collection it adds to. */}
        <Tooltip content={collapsed ? "Add source" : undefined} side="right">
          <button
            onClick={onNavigateToMarketplace}
            aria-label="Add source"
            aria-current={isMarketplace ? "page" : undefined}
            className={clsx(
              "flex items-center w-full rounded-lg font-medium mt-2",
              "transition-all duration-150 active:scale-[0.97]",
              isMarketplace
                ? "bg-accent/15 text-accent"
                : "text-accent/85 hover:bg-accent/10 hover:text-accent",
              collapsed
                ? "justify-center py-1.5 px-0"
                : "gap-2.5 px-2.5 py-1.5 text-ui-body",
            )}
          >
            <span className="shrink-0 flex items-center justify-center w-5 h-5">
              <Plus size={15} strokeWidth={2.5} />
            </span>
            {!collapsed && <span className="truncate">Add source</span>}
          </button>
        </Tooltip>
      </nav>

      {/* Footer — settings, collapse toggle, status */}
      <div
        className={clsx(
          "shrink-0 border-t border-edge py-2 space-y-0.5",
          collapsed ? "px-1" : "px-2",
        )}
      >
        <NavItem
          icon={<Settings size={15} />}
          label="Settings"
          active={isSettings}
          collapsed={collapsed}
          onClick={onNavigateToSettings}
        />

        <NavItem
          icon={<LifeBuoy size={15} />}
          label="Support"
          active={isSupport}
          collapsed={collapsed}
          onClick={onNavigateToSupport}
        />

        {/* Collapse toggle. Connection status + ticker status are now
            in the TopBar (always-visible chrome at the top of the
            window) — see components/TopBar.tsx. The sidebar footer
            stays minimal. */}
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
    </aside>
  );
}

// ── Nav item ────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={collapsed ? label : undefined} side="right">
      <button
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={clsx(
          "relative flex items-center w-full rounded-lg font-medium",
          "transition-all duration-150 active:scale-[0.97]",
          collapsed
            ? "justify-center py-1.5 px-0"
            : "gap-2.5 px-2.5 py-1.5 text-ui-body",
          active
            ? "bg-accent/10 text-fg"
            : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
        )}
      >
        {/* Active indicator — left accent bar. Uses motion's
            layoutId so it slides between nav items when the active
            page changes, instead of popping in/out. */}
        {active && (
          <motion.span
            layoutId="sidebar-active-indicator"
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent"
          />
        )}
        <span className="shrink-0 flex items-center justify-center w-5 h-5">
          {icon}
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    </Tooltip>
  );
}
