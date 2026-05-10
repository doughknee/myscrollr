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
import { ArrowLeft, ArrowRight, ChevronDown, Pin, Radio, RadioTower } from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import Tooltip from "./Tooltip";
import ConnectionIndicator from "./ConnectionIndicator";
import ScrollLogo from "./ScrollLogo";
import OverflowMenu from "./OverflowMenu";
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
        <span className="text-ui-body font-semibold tracking-tight">
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

      {/* ── Page identity (breadcrumb) ──────────────────────────
          Layout: parentLabel / title / subtitle
          The LAST segment (subtitle if any, otherwise title) becomes
          the trigger for the page's contextual menu when menuItems is
          provided. Breadcrumb segment IS the menu — no separate
          "Options" button competing for attention. */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden text-ui-meta">
        {page && (
          <>
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

            {/* Title segment — clickable when onTitleClick is set
                AND it's not the last segment (which is reserved for
                the menu trigger). */}
            {(() => {
              const titleIsLast = !page.subtitle;
              const titleIsMenuTrigger =
                titleIsLast && Boolean(page.menuItems?.length);

              if (titleIsMenuTrigger) {
                // Title is the menu trigger — render via OverflowMenu
                // with a custom trigger that looks like a breadcrumb
                // segment with a chevron.
                return (
                  <OverflowMenu
                    items={page.menuItems!}
                    triggerLabel={page.menuLabel ?? "Page options"}
                    trigger={<BreadcrumbMenuTrigger label={page.title} />}
                  />
                );
              }
              if (page.onTitleClick) {
                return (
                  <button
                    onClick={page.onTitleClick}
                    className="font-semibold text-fg-2 hover:text-fg truncate transition-colors"
                  >
                    {page.title}
                  </button>
                );
              }
              return (
                <span className="font-semibold text-fg truncate">
                  {page.title}
                </span>
              );
            })()}

            {/* Subtitle segment — slides in when entering a sub-route
                and out when leaving. Keyed on the subtitle text so
                switching between Configure and Display also animates. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {page.subtitle && (
                <motion.div
                  key={page.subtitle}
                  initial={{ opacity: 0, x: -6, filter: "blur(2px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -6, filter: "blur(2px)" }}
                  transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                  className="flex items-center gap-1.5 min-w-0"
                >
                  <span className="text-fg-4 shrink-0" aria-hidden>
                    /
                  </span>
                  {page.menuItems?.length ? (
                    <OverflowMenu
                      items={page.menuItems}
                      triggerLabel={page.menuLabel ?? "Page options"}
                      trigger={
                        <BreadcrumbMenuTrigger
                          label={page.subtitle}
                          muted
                        />
                      }
                    />
                  ) : (
                    <span className="text-fg-3 truncate">{page.subtitle}</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Fallback non-menu action (rare). */}
            {page.entityAction && !page.menuItems?.length && (
              <div className="shrink-0 flex items-center gap-1 ml-1">
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
              "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-ui-chip font-medium transition-all duration-200 active:scale-95",
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
              "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 active:scale-90",
              pinned
                ? "bg-info/15 text-info hover:bg-info/20"
                : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
            )}
          >
            <Pin
              size={12}
              className={clsx(
                "transition-transform duration-200",
                pinned && "fill-current rotate-45",
              )}
            />
          </button>
        </Tooltip>

        <div className="w-px h-5 bg-edge/40 mx-1" />

        <ConnectionIndicator health={health} />
      </div>
    </div>
  );
}

// ── Breadcrumb-as-menu-trigger ──────────────────────────────────
//
// Renders a breadcrumb segment that doubles as the OverflowMenu
// trigger. Clicking the segment opens the menu. Visually it looks
// like the segment with a small chevron suffix, so the menu's
// existence is discoverable but the segment still reads as page
// identity rather than a separate "Options" button.
//
// React forwards arbitrary props (including the ref injected by
// floating-ui's cloneElement) so this component must be a plain
// element receiver — we build it as a button.

interface BreadcrumbMenuTriggerProps {
  label: string;
  /** When true, renders in subtitle (muted) styling instead of title. */
  muted?: boolean;
}

function BreadcrumbMenuTrigger({
  label,
  muted = false,
  ...rest
}: BreadcrumbMenuTriggerProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // floating-ui injects aria-expanded onto the trigger; we read it
  // here to flip the chevron orientation so the trigger feels like a
  // proper dropdown affordance.
  const isOpen = rest["aria-expanded"] === true || rest["aria-expanded"] === "true";

  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        "group flex items-center gap-1 px-1 -mx-1 rounded-md min-w-0 transition-colors",
        "hover:bg-surface-hover",
        isOpen && "bg-surface-hover",
        muted ? "text-fg-3 hover:text-fg-2" : "font-semibold text-fg-2 hover:text-fg",
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown
        size={11}
        // 500ms calculated duration on a snap spring — feels more
        // satisfying than the default linear flip without dragging.
        style={{
          transition: "transform 500ms var(--ease-snap)",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
        }}
        className={clsx(
          "shrink-0",
          "text-fg-3",
          "group-hover:text-fg-2 transition-colors",
        )}
      />
    </button>
  );
}
