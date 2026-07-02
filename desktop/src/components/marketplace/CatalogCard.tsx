import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { CatalogItem } from "../../marketplace";
import { CATEGORY_LABELS, readableTextOn } from "../../marketplace";
import type { SubscriptionTier } from "../../auth";
import { TIER_LABELS } from "../../auth";

// ── Props ───────────────────────────────────────────────────────

interface CatalogCardProps {
  item: CatalogItem;
  enabled: boolean;
  tier: SubscriptionTier;
  authenticated: boolean;
  /** True when the user is at their plan's widget-slot limit. New adds are
   *  locked; already-added and tier-locked items keep their own states. */
  slotsAtCapacity?: boolean;
  /** Disable Add button while dashboard is loading (channels enabled state unknown). */
  dashboardLoading: boolean;
  onAdd: (item: CatalogItem) => Promise<void>;
  onLogin: () => void;
  /** Open the widget's main view (feed) when already added. */
  onOpen?: (item: CatalogItem) => void;
  /** Open the widget's configuration when already added. */
  onConfigure?: (item: CatalogItem) => void;
  /** Open the widget's "more info" page. Fires on card body click/Enter —
   *  the corner action (Add/Configure) stops propagation so it doesn't. */
  onInfo?: (item: CatalogItem) => void;
}

// ── Component ───────────────────────────────────────────────────

export default function CatalogCard({
  item,
  enabled,
  tier,
  authenticated,
  slotsAtCapacity,
  dashboardLoading,
  onAdd,
  onLogin,
  onOpen,
  onConfigure,
  onInfo,
}: CatalogCardProps) {
  const [loading, setLoading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const tierLocked =
    authenticated && item.requiredTier !== "free" && !tierMeetsRequirement(tier, item.requiredTier);

  // At the plan's widget-slot cap: lock *new* adds. The cap applies to
  // everyone (free = 3 widgets), including signed-out/demo sessions, since
  // local widgets count toward it too ("every widget counts"). Already-added
  // and tier-locked items keep their own states.
  const slotLocked = !!slotsAtCapacity && !enabled && !tierLocked;

  async function handleAdd() {
    if (!authenticated && item.kind === "data") {
      onLogin();
      return;
    }
    if (tierLocked || slotLocked) {
      open("https://myscrollr.com/uplink");
      return;
    }
    setLoading(true);
    try {
      await onAdd(item);
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────

  const Icon = item.icon;

  return (
    <div
      // The whole card body is the "learn more" affordance — clicking (or
      // Enter/Space when focused) opens the widget's info page. The corner
      // action (Add/Configure) stops propagation so it stays a separate hit.
      role={onInfo ? "button" : undefined}
      tabIndex={onInfo ? 0 : undefined}
      aria-label={onInfo ? `More about ${item.name}` : undefined}
      onClick={onInfo ? () => onInfo(item) : undefined}
      onKeyDown={
        onInfo
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onInfo(item);
              }
            }
          : undefined
      }
      className={clsx(
        "group/card relative flex flex-col overflow-hidden rounded-xl border border-edge/40 bg-base-150/30 p-4",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft-sm hover:border-edge/60 hover:bg-base-150/50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        onInfo && "cursor-pointer",
        // Added cards de-emphasized so new content stays prominent.
        enabled && "opacity-80 hover:opacity-100",
      )}
    >
      {/* Brand wash — a single vertical fade of the widget's color across the
          whole card, so there's no seam where a header band would end. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          background: `linear-gradient(to bottom, ${item.hex}30 0%, ${item.hex}0a 45%, transparent 100%)`,
        }}
      />

      {/* Content */}
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center gap-3">
          {item.logoUrl && !logoFailed ? (
            <img
              src={item.logoUrl}
              alt=""
              loading="lazy"
              className={clsx(
                "w-10 h-10 rounded-lg object-contain shrink-0",
                // Transparent/dark marks (UFC) need a light tile or they
                // disappear flush on a dark card.
                item.logoLight && "bg-white p-1",
              )}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${item.hex}20`, color: item.hex }}
            >
              <Icon size={22} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-ui-body font-semibold truncate">{item.name}</span>
              {enabled && (
                <span className="flex items-center gap-0.5 text-ui-chip font-medium text-success shrink-0">
                  <Check size={10} />
                  Added
                </span>
              )}
            </div>
            <span className="text-ui-chip font-semibold uppercase tracking-wide text-fg-4">
              {CATEGORY_LABELS[item.category]}
            </span>
          </div>
        </div>

        {/* Reserve exactly two lines (leading-relaxed = 1.625 → 3.25em) so
            1- and 2-line descriptions occupy the same height and cards stay
            uniform without inflating the whole card. */}
        <p className="mt-2.5 text-ui-meta leading-relaxed line-clamp-2 h-[3.25em]">
          {item.description}
        </p>

        {/* Locked context (subtle, in flow). The row's height is
            RESERVED on every card — same trick as the description's
            h-[3.25em] above — so a "limit reached" state doesn't make
            locked cards taller and reflow the whole grid. */}
        <div className="mt-2.5 h-[1.75em]">
          {tierLocked ? (
            <span className="inline-block w-fit rounded-md bg-warn/10 border border-warn/20 px-2 py-0.5 text-ui-chip font-medium text-warn">
              Requires {TIER_LABELS[item.requiredTier]}
            </span>
          ) : slotLocked ? (
            <span className="inline-block w-fit rounded-md bg-warn/10 border border-warn/20 px-2 py-0.5 text-ui-chip font-medium text-warn">
              Widget limit reached
            </span>
          ) : null}
        </div>
      </div>

      {/* Action — revealed on hover (or keyboard focus), absolutely positioned
          so it never adds height or shouts on every card. Its own background +
          shadow keep it readable over the content. stopPropagation keeps a
          click/keypress here from also opening the info page (card body). */}
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute bottom-3 right-3 opacity-0 translate-y-1 transition-all duration-150 group-hover/card:opacity-100 group-hover/card:translate-y-0 focus-within:opacity-100 focus-within:translate-y-0"
      >
        {loading ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-base-100/80 shadow-soft-sm">
            <Loader2 size={14} className="animate-spin text-fg-4" />
          </span>
        ) : enabled ? (
          // Added: a text "Configure" (secondary) beside a solid "Open"
          // (primary) — settings vs. the live view.
          <div className="flex items-center gap-1">
            <button
              onClick={() => onConfigure?.(item)}
              className="rounded-lg px-2 py-1 text-ui-chip font-semibold text-fg-3 transition-colors hover:bg-base-200/70 hover:text-fg-1"
            >
              Configure
            </button>
            <button
              onClick={() => onOpen?.(item)}
              style={{ backgroundColor: item.hex, color: readableTextOn(item.hex) }}
              className="group/btn flex items-center gap-0.5 rounded-lg px-2.5 py-1 text-ui-chip font-semibold shadow-soft-sm transition-all duration-150 active:scale-95 hover:brightness-110"
            >
              Open
              <ChevronRight
                size={12}
                className="transition-transform duration-200 group-hover/btn:translate-x-0.5"
              />
            </button>
          </div>
        ) : tierLocked || slotLocked ? (
          <button
            onClick={() => open("https://myscrollr.com/uplink")}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-ui-chip font-semibold text-warn bg-warn/15 hover:bg-warn/25 shadow-soft-sm transition-all duration-150 active:scale-95"
          >
            Upgrade <ExternalLink size={10} />
          </button>
        ) : !authenticated && item.kind === "data" ? (
          <button
            onClick={onLogin}
            className="rounded-lg px-2.5 py-1 text-ui-chip font-semibold text-accent bg-accent/10 hover:bg-accent/[0.16] shadow-soft-sm transition-all duration-150 active:scale-95"
          >
            Sign in
          </button>
        ) : (
          <button
            onClick={handleAdd}
            disabled={dashboardLoading && item.kind === "data"}
            style={
              dashboardLoading && item.kind === "data"
                ? undefined
                : { backgroundColor: item.hex, color: readableTextOn(item.hex) }
            }
            className={clsx(
              "rounded-lg px-3 py-1 text-ui-chip font-semibold shadow-soft-sm transition-all duration-150 active:scale-95",
              dashboardLoading && item.kind === "data"
                ? "cursor-not-allowed bg-base-200/60 text-fg-4"
                : "hover:brightness-110",
            )}
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

const TIER_ORDER: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate", "super_user"];

function tierMeetsRequirement(current: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}
