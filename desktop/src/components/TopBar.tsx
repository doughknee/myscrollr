/**
 * TopBar — the app's primary chrome row.
 *
 * Layout:
 *   [logo + Scrollr] | [←][→] | breadcrumb · subtitle    [entityAction] | [Ticker] [📌] | [●Connected]
 *
 * The TopBar is the single canonical home for:
 *   - Brand mark (clickable → Home)
 *   - Forward/back navigation (Spotify-style)
 *   - Page identity (where am I — published via PageContext)
 *   - Page-level entity action (Trash on source pages)
 *   - Ambient toggles (ticker on/off, pin)
 *   - Connection status
 *
 * Page-level chrome (title + breadcrumb) used to live inside the
 * route's content area in a chunky 4-row header. It's now in the
 * TopBar, freeing the entire content area for actual content.
 */
import { ArrowLeft, ArrowRight, Pin, Radio, RadioTower } from "lucide-react";
import clsx from "clsx";
import Tooltip from "./Tooltip";
import ConnectionIndicator from "./ConnectionIndicator";
import ScrollLogo from "./ScrollLogo";
import { usePageIdentity } from "./layout/page-context";
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

// ── Props ───────────────────────────────────────────────────────

interface TopBarProps {
  tickerOn: boolean;
  pinned: boolean;
  health: DeliveryHealth;
  canBack: boolean;
  canForward: boolean;
  onNavigateHome: () => void;
  onBack: () => void;
  onForward: () => void;
  onToggleTicker: () => void;
  onTogglePin: () => void;
}

// ── Component ───────────────────────────────────────────────────

export default function TopBar({
  tickerOn,
  pinned,
  health,
  canBack,
  canForward,
  onNavigateHome,
  onBack,
  onForward,
  onToggleTicker,
  onTogglePin,
}: TopBarProps) {
  const page = usePageIdentity();

  return (
    <div
      role="toolbar"
      aria-label="App controls"
      className="flex items-center h-11 shrink-0 px-3 gap-2 border-b border-edge/40 bg-surface-2/40 backdrop-blur-sm select-none"
    >
      {/* ── Brand mark (left) ──────────────────────────────── */}
      <button
        onClick={onNavigateHome}
        aria-label="Scrollr — go to home"
        className="flex items-center gap-2 px-1.5 h-7 rounded-md hover:bg-surface-hover transition-colors shrink-0"
      >
        <ScrollLogo alive={tickerOn} size={20} />
        <span className="text-[13px] font-semibold text-fg tracking-tight">
          Scrollr
        </span>
      </button>

      <div className="w-px h-5 bg-edge/40 mx-1 shrink-0" />

      {/* ── Back / Forward — Spotify-style ─────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip content="Back" side="bottom">
          <button
            onClick={onBack}
            disabled={!canBack}
            aria-label="Go back"
            className={clsx(
              "flex items-center justify-center w-7 h-7 rounded-md transition-colors",
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
              "flex items-center justify-center w-7 h-7 rounded-md transition-colors",
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

      {/* ── Page identity (breadcrumb) ──────────────────────── */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        {page && (
          <>
            <div className="flex items-center gap-1.5 min-w-0 text-[12px]">
              {page.parentLabel && page.onParentClick && (
                <>
                  <button
                    onClick={page.onParentClick}
                    className="text-fg-4 hover:text-fg-2 transition-colors shrink-0"
                  >
                    {page.parentLabel}
                  </button>
                  <span className="text-fg-4/50 shrink-0">/</span>
                </>
              )}
              <span className="font-semibold text-fg truncate">
                {page.title}
              </span>
              {page.subtitle && (
                <>
                  <span className="text-fg-4/40 shrink-0" aria-hidden>
                    ·
                  </span>
                  <span className="text-fg-4 truncate hidden lg:inline">
                    {page.subtitle}
                  </span>
                </>
              )}
            </div>

            {/* Entity action (e.g. Trash on source pages) sits right
                after the page title, treated as a contextual tool that
                belongs to this page entity. */}
            {page.entityAction && (
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
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors",
              tickerOn
                ? "bg-accent/15 text-accent hover:bg-accent/20"
                : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            {tickerOn ? <RadioTower size={12} /> : <Radio size={12} />}
            <span>Ticker</span>
          </button>
        </Tooltip>

        <Tooltip
          content={
            pinned ? "Stop keeping window above others" : "Keep window above other windows"
          }
          side="bottom"
        >
          <button
            type="button"
            role="switch"
            aria-checked={pinned}
            onClick={onTogglePin}
            aria-label={pinned ? "Unpin window" : "Pin window on top"}
            className={clsx(
              "flex items-center justify-center w-7 h-7 rounded-md transition-colors",
              pinned
                ? "bg-info/15 text-info hover:bg-info/20"
                : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            <Pin size={12} className={clsx(pinned && "fill-current")} />
          </button>
        </Tooltip>

        <div className="w-px h-5 bg-edge/40 mx-1" />

        <ConnectionIndicator health={health} />
      </div>
    </div>
  );
}
