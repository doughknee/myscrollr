/**
 * TopBar — the app's primary chrome row.
 *
 * Layout:
 *   [logo + Scrollr] | [←][→] | breadcrumb · subtitle    [entityAction] | [Ticker]
 *
 * The TopBar is the single canonical home for:
 *   - Brand mark
 *   - Forward/back navigation (Spotify-style)
 *   - Page identity (where am I — published via PageContext)
 *   - Page-level entity action (Trash on source pages)
 *   - Ambient toggles (ticker on/off)
 *
 * Page-level chrome (title + breadcrumb) used to live inside the
 * route's content area in a chunky 4-row header. It's now in the
 * TopBar, freeing the entire content area for actual content.
 */
import {
  ArrowLeft,
  ArrowRight,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RadioTower,
} from "lucide-react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Tooltip from "./Tooltip";
import WindowControls, { IS_MACOS } from "./WindowControls";
import ScrollLogo from "./ScrollLogo";
import OverflowMenu from "./OverflowMenu";
import type { OverflowMenuItem } from "./OverflowMenu";
import { usePageIdentity } from "./layout/page-context";

// ── Props ───────────────────────────────────────────────────────

interface TopBarProps {
  tickerOn: boolean;
  /** Collapsed state of the nav rail. Owned by the shell, since the
   *  toggle lives here but the rail is a sibling component. */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onToggleTicker: () => void;
}

// ── Frameless-window drag region ────────────────────────────────
//
// The TopBar doubles as the title bar on every platform: empty areas
// move the window, double-click toggles maximize — the same contract
// as native chrome. Drag is via JS (startDragging), NOT CSS
// app-region: app-region makes macOS WKWebView swallow mouse events
// before they reach JavaScript, breaking all buttons.
//
// macOS runs titleBarStyle: "Overlay" — the traffic lights stay
// native but the title bar is transparent and our content renders
// under it, so the bar below the lights is ours to make draggable.
// Known Tauri limitation: an unfocused window can't be dragged
// (tauri-apps/tauri#4316); the first click focuses it.
function handleDragRegion(e: React.MouseEvent) {
  if (e.buttons !== 1) return;
  // Interactive children keep their normal behavior.
  if ((e.target as HTMLElement).closest("button, a, input")) return;
  const win = getCurrentWindow();
  if (e.detail === 2) void win.toggleMaximize();
  else void win.startDragging();
}

// ── Component ───────────────────────────────────────────────────

export default function TopBar({
  tickerOn,
  sidebarCollapsed,
  onToggleSidebar,
  canBack,
  canForward,
  onBack,
  onForward,
  onToggleTicker,
}: TopBarProps) {
  const page = usePageIdentity();

  return (
    <div
      role="toolbar"
      aria-label="App controls"
      onMouseDown={handleDragRegion}
      className={clsx(
        // 38px is not a style choice — it is the height macOS gives the
        // title bar once src-tauri/src/titlebar.rs attaches a
        // UnifiedCompact toolbar, measured on a running window. macOS
        // centres the traffic lights in that bar, at 19px, so a 38px row
        // centres its own content on exactly the same line. Any other
        // height puts them off by half the difference — which is why the
        // stock 28pt bar could never be both roomy and aligned.
        //
        // Keep this in step with the toolbar style: Unified gives 52px,
        // UnifiedCompact 38px. Changing one without the other misaligns
        // the lights.
        "flex items-center h-[38px] shrink-0 px-3 gap-2 select-none",
        // The lights occupy x=7..61 (three 14pt buttons, 20pt apart, as
        // measured). Inset past them so the row's first control clears
        // the cluster with a little breathing room.
        IS_MACOS && "pl-[78px]",
      )}
    >
      {/* ── Brand mark (Windows/Linux) ───────────────────────
          Leads the row on the frameless platforms, where the left
          corner is ours to use. macOS can't have it here — the traffic
          lights are drawn over that corner — so it trails the row
          there instead. */}
      {!IS_MACOS && (
        <>
          <BrandMark />
          <div className="w-px h-5 bg-edge/40 mx-1 shrink-0" />
        </>
      )}

      {/* ── Sidebar toggle ──────────────────────────────────
          Leads the row, ahead of Back: it acts on the rail to its
          left, so it reads as belonging to that edge rather than to
          the navigation cluster. */}
      <Tooltip
        content={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        side="bottom"
      >
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md text-fg-3 hover:text-fg-2 hover:bg-surface-hover"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={14} />
          ) : (
            <PanelLeftClose size={14} />
          )}
        </button>
      </Tooltip>

      <div className="w-px h-5 bg-edge/40 mx-1 shrink-0" />

      {/* ── Back / Forward — Spotify-style ─────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip content="Back" side="bottom">
          <button
            onClick={onBack}
            disabled={!canBack}
            aria-label="Go back"
            className={clsx(
              "flex items-center justify-center w-7 h-7 rounded-md",
              canBack
                ? "text-fg-2 hover:text-fg hover:bg-surface-hover"
                : "text-fg-4/40 cursor-not-allowed",
            )}
          >
            <ArrowLeft size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Forward" side="bottom">
          <button
            onClick={onForward}
            disabled={!canForward}
            aria-label="Go forward"
            className={clsx(
              "flex items-center justify-center w-7 h-7 rounded-md",
              canForward
                ? "text-fg-2 hover:text-fg hover:bg-surface-hover"
                : "text-fg-4/40 cursor-not-allowed",
            )}
          >
            <ArrowRight size={14} />
          </button>
        </Tooltip>
      </div>

      <div className="w-px h-5 bg-edge/40 mx-1 shrink-0" />

      {/* ── Page identity + inline tab strip ────────────────────
          Layout in this row:
            [parentLabel / title (/ subtitle)]  [tab pills]  [Options]
          Breadcrumb segments are plain navigation text (sub-route
          titles are back-link buttons via onTitleClick). Sibling-tab
          nav is a compact segmented pill control inline in the bar
          — no full-width tab band wasting vertical space. The
          "Options" pill is the sole page-menu trigger. When tabs are
          present, subtitle is suppressed (the active pill conveys the
          same info). Walkthrough fix 2026-05-11 round 3. */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden text-ui-meta">
        {page && (
          <>
            {/* Breadcrumb — always shrink-friendly. */}
            <div className="flex items-center gap-1.5 min-w-0 shrink">
              {page.parentLabel && page.onParentClick && (
                <>
                  <button
                    onClick={page.onParentClick}
                    className="text-fg-3 hover:text-fg-2 shrink-0"
                  >
                    {page.parentLabel}
                  </button>
                  <span className="text-fg-4 shrink-0" aria-hidden>
                    /
                  </span>
                </>
              )}

              {page.onTitleClick ? (
                <button
                  onClick={page.onTitleClick}
                  className="font-semibold text-fg-2 hover:text-fg truncate "
                >
                  {page.title}
                </button>
              ) : (
                <span className="font-semibold text-fg truncate">
                  {page.title}
                </span>
              )}

              {page.subtitle && (
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-fg-4 shrink-0" aria-hidden>
                      /
                    </span>
                    <span className="text-fg-3 truncate">
                      {page.subtitle}
                    </span>
                </div>
              )}
            </div>

            {/* Spacer — sibling navigation lives in each page's WCB
                Segmented now (the TopBar tab strip died with its last
                consumer, Support, in REL-49). Options pins right. */}
            <div className="flex-1 min-w-0" aria-hidden />

            {/* "Options" pill — the sole trigger for page-level menus. */}
            {page.menuItems?.length ? (
              <div className="shrink-0">
                <OverflowMenu
                  items={page.menuItems}
                  triggerLabel={page.menuLabel ?? "Page options"}
                />
              </div>
            ) : null}

            {/* Fallback non-menu action (rare). */}
            {page.entityAction && !page.menuItems?.length && (
              <div className="shrink-0 flex items-center gap-1">
                {page.entityAction}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Ambient toggles (right) ─────────────────────────── */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip
          content={tickerOn ? "Hide the ticker window" : "Show the ticker window"}
          side="bottom"
        >
          <button
            type="button"
            role="switch"
            aria-checked={tickerOn}
            onClick={onToggleTicker}
            className={clsx(
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-chip font-medium",
              tickerOn
                ? "bg-accent/15 text-accent hover:bg-accent/20"
                : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tickerOn ? <RadioTower size={12} /> : <Radio size={12} />}
            <span>Ticker</span>
          </button>
        </Tooltip>

        {/* macOS only: the brand mark trails the row because the
            traffic lights own the left corner under titleBarStyle
            "Overlay". Everywhere else it leads — see the top of the row. */}
        {IS_MACOS && (
          <>
            <div className="w-px h-5 bg-edge/40 mx-1 shrink-0" />
            <BrandMark />
          </>
        )}
      </div>

      {/* ── Window controls (Windows/Linux frameless only) ────
          self-stretch: full bar height; -mr-3 cancels the bar's px-3
          so the buttons sit flush in the window corner. */}
      {!IS_MACOS && (
        <div className="flex self-stretch ml-1 -mr-3">
          <WindowControls />
        </div>
      )}
    </div>
  );
}


// ── Brand mark ──────────────────────────────────────────────────
//
// Rendered at one end of the row or the other depending on platform:
// leading on Windows/Linux, trailing on macOS. It is the same mark
// either way, so it lives here rather than being written twice.

function BrandMark() {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 px-1.5">
      <ScrollLogo size={20} />
      <span className="text-ui-body font-semibold tracking-tight">Scrollr</span>
    </div>
  );
}
