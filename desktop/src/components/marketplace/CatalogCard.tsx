import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { CatalogItem, CatalogCategory } from "../../marketplace";
import type { SubscriptionTier } from "../../auth";
import { TIER_LABELS } from "../../auth";

// ── Category badge ──────────────────────────────────────────────

const CATEGORY_BADGE: Record<CatalogCategory, string> = {
  channel: "Channel",
  widget: "Widget",
};

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
  /** Navigate to the channel/widget page when already added. */
  onOpen?: (item: CatalogItem) => void;
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
}: CatalogCardProps) {
  const [loading, setLoading] = useState(false);

  const tierLocked =
    authenticated && item.requiredTier !== "free" && !tierMeetsRequirement(tier, item.requiredTier);

  // At the plan's widget-slot cap: lock *new* adds. Already-added items keep
  // their "Open" state; tier-locked items keep their own upsell.
  const slotLocked = !!slotsAtCapacity && !enabled && !tierLocked && authenticated;

  async function handleAdd() {
    if (!authenticated && item.kind === "channel") {
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
      className={clsx(
        // Matches the dense Section card chrome used on Settings,
        // Ticker, and Account so the catalog reads as part of the
        // same surface vocabulary instead of its own visual island.
        "rounded-xl border border-edge/35 bg-base-150/35 p-3.5",
        // Subtle 200ms hover lift gives the grid life without
        // becoming distracting.
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft-sm hover:border-edge/55 hover:bg-base-150/55",
        // Visual hierarchy: not-added cards lead the eye; added
        // cards visually de-emphasized so power users can still
        // navigate to their sources but new content stays prominent.
        enabled && "opacity-70 hover:opacity-100",
        tierLocked && "opacity-80",
      )}
    >
      {/* Header row: icon + name + category badge */}
      <div className="flex items-start gap-3 mb-2.5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${item.hex}15`, color: item.hex }}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-ui-body font-semibold truncate">{item.name}</span>
            {enabled && (
              <span className="flex items-center gap-1 text-ui-chip font-medium text-success">
                <Check size={10} />
                Added
              </span>
            )}
          </div>
          <span className="text-ui-section">
            {CATEGORY_BADGE[item.category]}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-ui-meta leading-relaxed mb-3 line-clamp-2">
        {item.description}
      </p>

      {/* Tier badge (only when locked) */}
      {tierLocked && (
        <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1 rounded-md bg-warn/10 border border-warn/20 w-fit">
          <span className="text-ui-chip font-medium text-warn">
            Requires {TIER_LABELS[item.requiredTier]}
          </span>
        </div>
      )}

      {/* Widget-slot limit badge */}
      {slotLocked && (
        <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1 rounded-md bg-warn/10 border border-warn/20 w-fit">
          <span className="text-ui-chip font-medium text-warn">
            Widget limit reached
          </span>
        </div>
      )}

      {/* Unauthenticated channel hint */}
      {!authenticated && item.kind === "channel" && !enabled && (
        <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1 rounded-md bg-info/10 border border-info/20 w-fit">
          <span className="text-ui-chip font-medium text-info">
            Sign in to add
          </span>
        </div>
      )}

      {/* Action */}
      <div className="flex items-center justify-end">
        {loading ? (
          <Loader2 size={14} className="animate-spin text-fg-4" />
        ) : enabled ? (
          // Already added: channels open straight to Configure (the catalog
          // is the one place to add AND set up a source); widgets open their
          // page. Removal happens there via Trash + Undo. One home per verb.
          onOpen && (
            <button
              onClick={() => onOpen(item)}
              className="group flex items-center gap-0.5 text-ui-chip font-semibold text-accent hover:text-accent/80 transition-all duration-150 active:scale-95"
            >
              {item.kind === "channel" ? "Configure" : "Open"}
              <ChevronRight
                size={12}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </button>
          )
        ) : tierLocked || slotLocked ? (
          <button
            onClick={() => open("https://myscrollr.com/uplink")}
            className="flex items-center gap-1 text-ui-chip font-medium text-warn hover:text-warn/80 transition-all duration-150 active:scale-95"
          >
            Upgrade <ExternalLink size={10} />
          </button>
        ) : !authenticated && item.kind === "channel" ? (
          <button
            onClick={onLogin}
            className="text-ui-chip font-semibold text-accent hover:text-accent/80 transition-all duration-150 active:scale-95"
          >
            Sign in to add
          </button>
        ) : (
          <button
            onClick={handleAdd}
            disabled={dashboardLoading && item.kind === "channel"}
            className={clsx(
              "text-ui-chip font-semibold transition-all duration-150 active:scale-95",
              dashboardLoading && item.kind === "channel"
                ? "text-fg-4 cursor-not-allowed"
                : "text-accent hover:text-accent/80",
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
