import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { CatalogItem } from "../../marketplace";
import { CATEGORY_LABELS } from "../../marketplace";
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
      className={clsx(
        "group/card flex flex-col rounded-xl border border-edge/40 overflow-hidden bg-base-150/30",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft-sm hover:border-edge/60 hover:bg-base-150/50",
        // Added cards de-emphasized so new content stays prominent.
        enabled && "opacity-80 hover:opacity-100",
      )}
    >
      {/* Brand header band — a subtle wash of the widget's own color, with
          the real logo (no bubble) or a colored icon fallback. */}
      <div
        className="flex items-center gap-3 px-4 pt-4 pb-3"
        style={{
          background: `linear-gradient(135deg, ${item.hex}26 0%, ${item.hex}0d 55%, transparent 100%)`,
        }}
      >
        {item.logoUrl && !logoFailed ? (
          <img
            src={item.logoUrl}
            alt=""
            loading="lazy"
            className="w-10 h-10 rounded-lg object-contain shrink-0"
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
          <span
            className="text-ui-chip font-semibold uppercase tracking-wide"
            style={{ color: item.hex }}
          >
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col px-4 pb-3.5 pt-2.5">
        <p className="text-ui-meta leading-relaxed line-clamp-2 min-h-[2.4em]">
          {item.description}
        </p>

        {/* Status badge — only one shows at a time. */}
        {tierLocked ? (
          <span className="mt-2.5 w-fit rounded-md bg-warn/10 border border-warn/20 px-2 py-0.5 text-ui-chip font-medium text-warn">
            Requires {TIER_LABELS[item.requiredTier]}
          </span>
        ) : slotLocked ? (
          <span className="mt-2.5 w-fit rounded-md bg-warn/10 border border-warn/20 px-2 py-0.5 text-ui-chip font-medium text-warn">
            Widget limit reached
          </span>
        ) : !authenticated && item.kind === "data" && !enabled ? (
          <span className="mt-2.5 w-fit rounded-md bg-info/10 border border-info/20 px-2 py-0.5 text-ui-chip font-medium text-info">
            Sign in to add
          </span>
        ) : null}

        {/* Action row — pinned to the bottom so cards align. */}
        <div className="mt-auto pt-3 flex items-center justify-end">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-fg-4" />
          ) : enabled ? (
            onOpen && (
              <button
                onClick={() => onOpen(item)}
                className="group/btn flex items-center gap-0.5 rounded-lg px-2.5 py-1 text-ui-chip font-semibold text-accent bg-accent/10 hover:bg-accent/[0.16] transition-all duration-150 active:scale-95"
              >
                {item.kind === "data" ? "Configure" : "Open"}
                <ChevronRight
                  size={12}
                  className="transition-transform duration-200 group-hover/btn:translate-x-0.5"
                />
              </button>
            )
          ) : tierLocked || slotLocked ? (
            <button
              onClick={() => open("https://myscrollr.com/uplink")}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-ui-chip font-semibold text-warn bg-warn/10 hover:bg-warn/[0.16] transition-all duration-150 active:scale-95"
            >
              Upgrade <ExternalLink size={10} />
            </button>
          ) : !authenticated && item.kind === "data" ? (
            <button
              onClick={onLogin}
              className="rounded-lg px-2.5 py-1 text-ui-chip font-semibold text-accent bg-accent/10 hover:bg-accent/[0.16] transition-all duration-150 active:scale-95"
            >
              Sign in
            </button>
          ) : (
            <button
              onClick={handleAdd}
              disabled={dashboardLoading && item.kind === "data"}
              className={clsx(
                "rounded-lg px-3 py-1 text-ui-chip font-semibold transition-all duration-150 active:scale-95",
                dashboardLoading && item.kind === "data"
                  ? "text-fg-4 cursor-not-allowed bg-base-200/40"
                  : "text-surface bg-accent hover:bg-accent/90",
              )}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

const TIER_ORDER: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate", "super_user"];

function tierMeetsRequirement(current: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}
