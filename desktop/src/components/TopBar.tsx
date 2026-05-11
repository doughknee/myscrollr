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
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Pin, Radio, RadioTower } from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import Tooltip from "./Tooltip";
import ConnectionIndicator from "./ConnectionIndicator";
import ScrollLogo from "./ScrollLogo";
import OverflowMenu from "./OverflowMenu";
import type { OverflowMenuItem } from "./OverflowMenu";
import { usePageIdentity, type PageTabStrip } from "./layout/page-context";
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

              {/* Subtitle slot — suppressed when tab pills are
                  showing (the active pill is the subtitle). */}
              <AnimatePresence mode="popLayout" initial={false}>
                {page.subtitle && !page.tabs && (
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
                    <span className="text-fg-3 truncate">
                      {page.subtitle}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Inline tab strip — sibling navigation as a segmented
                pill control. Renders only when the page publishes
                `tabs`. The strip itself takes flex-1 so it owns all
                available space (which is also what the adaptive
                overflow measurement needs to decide how many pills
                fit). When there are no tabs, an empty spacer fills
                the gap so Options pins to the right edge. */}
            {page.tabs ? (
              <InlineTabStrip tabs={page.tabs} />
            ) : (
              <div className="flex-1 min-w-0" aria-hidden />
            )}

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

// ── Inline tab strip ─────────────────────────────────────────────
//
// Compact segmented pill control that lives inline in the TopBar to
// expose sibling-tab navigation (Settings: Appearance/Ticker/Account,
// Catalog: All/Channels/Widgets, Support sections, etc.). Replaces the
// full-width content-area tab band that wasted vertical space.
//
// Adaptive overflow: when the available width can't fit every pill,
// the tail collapses into a "More ▾" menu. The active tab is always
// kept visible — if it would be in the overflow slice, earlier tabs
// are pushed into overflow instead so users always see where they
// currently are.
//
// Measurement uses an off-screen ghost row to learn each pill's
// natural width, then walks the list deciding what fits. A
// ResizeObserver on the container re-runs the calculation when the
// window or the breadcrumb width changes.

function InlineTabStrip({ tabs }: { tabs: PageTabStrip }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // Number of leading items currently rendered inline. The rest go
  // into the overflow menu. Starts at items.length so the first
  // render shows every pill; ResizeObserver immediately corrects it
  // if there isn't enough room.
  const [visibleCount, setVisibleCount] = useState(tabs.items.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const ghost = ghostRef.current;
    if (!container || !ghost) return;

    const recompute = () => {
      const available = container.clientWidth;
      if (available <= 0) return;

      // Measure each ghost pill + the ghost "More" trigger.
      const pillNodes = Array.from(
        ghost.querySelectorAll<HTMLElement>("[data-pill-index]"),
      );
      const widths = pillNodes.map((n) => n.offsetWidth);
      const moreNode = ghost.querySelector<HTMLElement>("[data-pill-more]");
      const moreWidth = moreNode?.offsetWidth ?? 0;

      // Gap between pills in the rendered strip (gap-0.5 = 2px).
      const gap = 2;

      // First, can everything fit without "More"?
      const total = widths.reduce(
        (sum, w, i) => sum + w + (i > 0 ? gap : 0),
        0,
      );
      if (total <= available) {
        setVisibleCount(widths.length);
        return;
      }

      // Otherwise reserve room for the "More" trigger and pack from
      // the left until the next pill won't fit.
      let used = moreWidth + gap;
      let fit = 0;
      for (let i = 0; i < widths.length; i++) {
        const next = widths[i] + (fit > 0 ? gap : 0);
        if (used + next > available) break;
        used += next;
        fit += 1;
      }

      // Guarantee at least one inline pill so the strip never
      // collapses entirely (the More menu would still work, but the
      // user loses the visual anchor).
      setVisibleCount(Math.max(1, fit));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [tabs.items]);

  // If the active tab would land in the overflow slice, shift the
  // visible window so it stays in view. We do this by re-ordering:
  // the displayed pills are the first `visibleCount` items, BUT we
  // swap the active tab into that slice if it isn't there.
  const activeIndex = tabs.items.findIndex((t) => t.key === tabs.activeKey);
  const inlineSet = (() => {
    const visible = tabs.items.slice(0, visibleCount);
    if (activeIndex < 0 || activeIndex < visibleCount) {
      return { visible, overflow: tabs.items.slice(visibleCount) };
    }
    // Active is in overflow — swap it with the last visible slot so
    // the active pill is always rendered inline.
    const swapped = visible.slice(0, -1);
    swapped.push(tabs.items[activeIndex]);
    const overflow = tabs.items.filter((t) => !swapped.includes(t));
    return { visible: swapped, overflow };
  })();

  const overflowMenuItems: OverflowMenuItem[] = inlineSet.overflow.map((t) => ({
    key: t.key,
    label: t.label,
    hint: t.description,
    onSelect: () => tabs.onChange(t.key),
  }));

  return (
    <div
      ref={containerRef}
      className="relative flex items-center min-w-0 flex-1"
    >
      {/* Visible strip. */}
      <nav
        aria-label={tabs.ariaLabel ?? "Page sections"}
        className="flex items-center gap-0.5 h-7 px-0.5 rounded-md bg-surface-1/60 border border-edge/40 max-w-full"
      >
        {inlineSet.visible.map((tab) => (
          <TabPill
            key={tab.key}
            label={tab.label}
            description={tab.description}
            isActive={tab.key === tabs.activeKey}
            onSelect={() => tabs.onChange(tab.key)}
          />
        ))}
        {inlineSet.overflow.length > 0 && (
          <OverflowMenu
            items={overflowMenuItems}
            triggerLabel="More sections"
            trigger={<MoreTabsTrigger />}
            placement="bottom-end"
          />
        )}
      </nav>

      {/* Ghost row — off-screen, used only for width measurement.
          Mirrors the styles of the real pills + trigger so widths
          match. aria-hidden so AT doesn't see duplicates. */}
      <div
        ref={ghostRef}
        aria-hidden
        className="absolute left-0 top-0 invisible pointer-events-none flex items-center gap-0.5 h-7 px-0.5"
        style={{ visibility: "hidden" }}
      >
        {tabs.items.map((tab, i) => (
          <span
            key={tab.key}
            data-pill-index={i}
            className="relative h-6 px-2.5 rounded text-[11px] font-medium whitespace-nowrap"
          >
            {tab.label}
          </span>
        ))}
        <span
          data-pill-more
          className="flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium whitespace-nowrap"
        >
          More
          <ChevronDown size={11} />
        </span>
      </div>
    </div>
  );
}

// Single pill button. Extracted so the visible strip and the ghost
// row can share the same dimensions without duplicating className.
function TabPill({
  label,
  description,
  isActive,
  onSelect,
}: {
  label: string;
  description?: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isActive ? "page" : undefined}
      title={description}
      className={clsx(
        "relative h-6 px-2.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap",
        isActive ? "text-fg" : "text-fg-3 hover:text-fg-2",
      )}
    >
      {isActive && (
        <motion.span
          layoutId="topbar-tab-active"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
          className="absolute inset-0 rounded bg-surface-3 shadow-sm"
        />
      )}
      <span className="relative">{label}</span>
    </button>
  );
}

// "More ▾" trigger styled to match TabPill so it visually belongs to
// the same segmented control. floating-ui injects a ref + handlers
// via cloneElement, so this is a forwardRef-compatible button.
const MoreTabsTrigger = forwardRef(function MoreTabsTrigger(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
  ref: Ref<HTMLButtonElement>,
) {
  const isOpen =
    props["aria-expanded"] === true || props["aria-expanded"] === "true";
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={clsx(
        "flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap",
        isOpen ? "bg-surface-3 text-fg" : "text-fg-3 hover:text-fg-2",
      )}
    >
      More
      <ChevronDown
        size={11}
        style={{
          transition: "transform 300ms var(--ease-snap)",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
        }}
      />
    </button>
  );
});

