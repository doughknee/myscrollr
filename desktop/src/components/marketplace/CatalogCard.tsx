import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight } from "lucide-react";
import type { CatalogItem } from "../../marketplace";
import { CATEGORY_LABELS } from "../../marketplace";

// ── Props ───────────────────────────────────────────────────────
//
// Browse-only card (v1.1.1 catalog redesign): the catalog shows what
// exists; every transaction (add / remove / configure / gating) lives
// on the widget's own info page. Clicking anywhere on the card goes
// there. No per-card buttons, no per-card lock badges — uniform,
// sleek, calm.

interface CatalogCardProps {
  item: CatalogItem;
  enabled: boolean;
  /** Open the widget's info page — the card's single affordance. */
  onInfo: (item: CatalogItem) => void;
}

// ── Component ───────────────────────────────────────────────────

export default function CatalogCard({ item, enabled, onInfo }: CatalogCardProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const Icon = item.icon;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`More about ${item.name}`}
      onClick={() => onInfo(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInfo(item);
        }
      }}
      className={clsx(
        "group/card relative flex flex-col overflow-hidden rounded-xl border border-edge/40 bg-base-150/30 p-4 cursor-pointer",
        "hover:shadow-soft-sm hover:border-edge/60 hover:bg-base-150/50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
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
            // App-icon tile — same treatment as the sidebar's SourceGlyph
            // fallback, so brandless widgets read as distinct logos here
            // too (white glyph on a gradient of the brand hex).
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white"
              style={{
                background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}b8 100%)`,
              }}
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
            uniform. */}
        <p className="mt-2.5 text-ui-meta leading-relaxed line-clamp-2 h-[3.25em]">
          {item.description}
        </p>
      </div>

      {/* "Learn more" affordance — a quiet hint, not a button; the card
          itself is the hit target. */}
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-0.5 text-ui-chip font-medium text-fg-4 opacity-0 group-hover/card:opacity-100">
        View
        <ChevronRight size={11} />
      </div>
    </div>
  );
}
