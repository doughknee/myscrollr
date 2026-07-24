/**
 * TopBar — the app's primary chrome row.
 *
 * Layout:
 *   [logo + Scrollr] | [←][→] | breadcrumb · subtitle    [entityAction] | [Ticker] | [⚡]
 *
 * The TopBar is the single canonical home for:
 *   - Brand mark (clickable → Home)
 *   - Forward/back navigation (Spotify-style)
 *   - Page identity (where am I — published via PageContext)
 *   - Page-level entity action (Trash on source pages)
 *   - Ambient toggles (ticker on/off)
 *   - Connection status
 *
 * Page-level chrome (title + breadcrumb) used to live inside the
 * route's content area in a chunky 4-row header. It's now in the
 * TopBar, freeing the entire content area for actual content.
 */
import { ArrowLeft, ArrowRight, Radio, RadioTower } from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Tooltip from "./Tooltip";
import WindowControls, { IS_MACOS } from "./WindowControls";
import ConnectionIndicator from "./ConnectionIndicator";
import ScrollLogo from "./ScrollLogo";
import OverflowMenu from "./OverflowMenu";
import type { OverflowMenuItem } from "./OverflowMenu";
import { usePageIdentity } from "./layout/page-context";
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

// ── Props ───────────────────────────────────────────────────────

interface TopBarProps {
  tickerOn: boolean;
  health: DeliveryHealth;
  canBack: boolean;
  canForward: boolean;
  /** Whether the What's New page is open — lights up the brand mark. */
  isReleases: boolean;
  /** Whether the Status page is open — lights up the indicator. */
  isStatus: boolean;
  onNavigateToReleases: () => void;
  onNavigateToStatus: () => void;
  onBack: () => void;
  onForward: () => void;
  onToggleTicker: () => void;
}

// ── Frameless-window drag region ────────────────────────────────
//
// On Windows/Linux the window is frameless and the TopBar doubles as
// the title bar: empty areas move the window, double-click toggles
// maximize — the same contract as native chrome. Drag is via JS
// (startDragging), NOT CSS app-region: app-region makes macOS
// WKWebView swallow mouse events before they reach JavaScript,
// breaking all buttons.
function handleDragRegion(e: React.MouseEvent) {
  if (IS_MACOS || e.buttons !== 1) return;
  // Interactive children keep their normal behavior.
  if ((e.target as HTMLElement).closest("button, a, input")) return;
  const win = getCurrentWindow();
  if (e.detail === 2) void win.toggleMaximize();
  else void win.startDragging();
}

// ── Component ───────────────────────────────────────────────────

export default function TopBar({
  tickerOn,
  health,
  canBack,
  canForward,
  isReleases,
  isStatus,
  onNavigateToReleases,
  onNavigateToStatus,
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
      className="flex items-center h-11 shrink-0 px-3 gap-2 select-none"
    >
      {/* ── Brand mark (left) ────────────────────────────────
          Home lives in the sidebar rail now, so the mark takes the
          "what's new" slot — the app's version + release notes. */}
      <Tooltip content="What's new" side="bottom">
        <button
          onClick={onNavigateToReleases}
          aria-label="Scrollr — what's new"
          aria-current={isReleases ? "page" : undefined}
          className={clsx(
            "flex items-center gap-2 px-1.5 h-7 rounded-md transition-colors shrink-0",
            isReleases
              ? "bg-accent/10 text-accent"
              : "hover:bg-surface-hover",
          )}
        >
          <ScrollLogo alive={tickerOn} size={20} />
          <span className="text-ui-body font-semibold tracking-tight">
            Scrollr
          </span>
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
              "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 active:scale-90",
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
              "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150 active:scale-90",
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
                    className="text-fg-3 hover:text-fg-2 transition-colors shrink-0"
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
                  className="font-semibold text-fg-2 hover:text-fg truncate transition-colors"
                >
                  {page.title}
                </button>
              ) : (
                <span className="font-semibold text-fg truncate">
                  {page.title}
                </span>
              )}

              {/* Subtitle slot. */}
              <AnimatePresence mode="popLayout" initial={false}>
                {page.subtitle && (
                  <motion.div
                    key={page.subtitle}
                    initial={{ opacity: 0, x: -6, filter: "blur(2px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: -6, filter: "blur(2px)" }}
                    transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    <span className="text-fg-4 shrink-0" aria-hidden>
                      /
                    </span>
                    <span className="text-fg-3 truncate">
                      {page.subtitle}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
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
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-chip font-medium transition-all duration-150 active:scale-95",
              tickerOn
                ? "bg-accent/15 text-accent hover:bg-accent/20"
                : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tickerOn ? <RadioTower size={12} /> : <Radio size={12} />}
            <span>Ticker</span>
          </button>
        </Tooltip>

        <div className="w-px h-5 bg-edge/40 mx-1" />

        <ConnectionIndicator
          health={health}
          active={isStatus}
          onClick={onNavigateToStatus}
        />
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

