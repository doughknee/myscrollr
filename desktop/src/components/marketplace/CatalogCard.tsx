import { useState } from "react";
import clsx from "clsx";
import { Check, Plus } from "lucide-react";
import type { CatalogItem } from "../../marketplace";
import { CATEGORY_LABELS } from "../../marketplace";

// ── Browse-AND-act card ─────────────────────────────────────────
//
// The catalog used to be browse-only — every transaction lived on the
// widget's info page, one navigation away. It's a store now: the card
// adds, and the card body opens details in a slide-over rather than
// navigating. Two variants:
//
//   rich    — the default. Logo tile on a brand gradient, name, category
//             kicker, two-line description on a vertical brand wash.
//   compact — sports. League descriptions are boilerplate ("Live NFL
//             scores…"), so a shelf of 14 rich cards is 14 restatements
//             of the same sentence. Logo + name + add button, 4-across.

interface CatalogCardProps {
  item: CatalogItem;
  added: boolean;
  variant?: "rich" | "compact";
  /** Open the detail panel. The card body is the hit target. */
  onOpen: (item: CatalogItem) => void;
  /**
   * Add without leaving the page. Omitted when the item is already
   * added; at slot capacity the caller passes a handler that opens the
   * panel instead, where the upgrade path is explained.
   */
  onAdd?: (item: CatalogItem) => void;
}

// ── Logo tile ───────────────────────────────────────────────────

function LogoTile({
  item,
  size,
  radius,
}: {
  item: CatalogItem;
  size: number;
  radius: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const Icon = item.icon;

  if (item.logoUrl && !logoFailed) {
    return (
      <img
        src={item.logoUrl}
        alt=""
        loading="lazy"
        className={clsx(
          "shrink-0 object-contain",
          radius,
          // Transparent/dark marks (UFC) need a light tile or they
          // disappear flush against a dark card.
          item.logoLight && "bg-white p-1",
        )}
        style={{ width: size, height: size }}
        onError={() => setLogoFailed(true)}
      />
    );
  }

  return (
    <div
      className={clsx(
        "flex shrink-0 items-center justify-center text-white",
        radius,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}b8 100%)`,
      }}
    >
      <Icon size={Math.round(size * 0.55)} />
    </div>
  );
}

// ── Add / added control ─────────────────────────────────────────

function AddControl({
  item,
  added,
  onAdd,
}: {
  item: CatalogItem;
  added: boolean;
  onAdd?: (item: CatalogItem) => void;
}) {
  if (added) {
    return (
      <span
        aria-label={`${item.name} added`}
        className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-accent/14 text-accent"
      >
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }
  return (
    <button
      type="button"
      // Named, not "Add to ticker": a screen reader running the shelf
      // otherwise hears the same three words fourteen times.
      aria-label={`Add ${item.name}`}
      onClick={(e) => {
        // The card body opens the panel; without this, adding would
        // also open it.
        e.stopPropagation();
        onAdd?.(item);
      }}
      className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-edge/70 bg-transparent text-accent hover:border-accent/50 hover:bg-accent/10"
    >
      <Plus size={13} strokeWidth={2.5} />
    </button>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function CatalogCard({
  item,
  added,
  variant = "rich",
  onOpen,
  onAdd,
}: CatalogCardProps) {
  const shared = {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `More about ${item.name}`,
    onClick: () => onOpen(item),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(item);
      }
    },
  };

  if (variant === "compact") {
    return (
      <div
        {...shared}
        className="group/card relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-[10px] border border-edge/55 bg-surface-raised px-2.5 py-2 hover:border-edge focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {/* Horizontal brand wash. Without it these tiles are bare
            surface-raised, which in a dark palette is a few percent off
            the panel behind them — the row reads as floating labels with
            no card under them. The rich variant gets its separation from
            a vertical wash; compact needs the same help, just along its
            own axis. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(to right, ${item.hex}26, transparent 70%)`,
          }}
        />
        <div className="relative flex w-full items-center gap-2.5">
          <LogoTile item={item} size={30} radius="rounded-[7px]" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg">
            {item.name}
          </span>
          <AddControl item={item} added={added} onAdd={onAdd} />
        </div>
      </div>
    );
  }

  return (
    <div
      {...shared}
      className="group/card relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-edge/55 bg-surface-raised p-3.5 hover:border-edge hover:shadow-soft-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      {/* Vertical brand wash — a single fade so there's no seam where a
          header band would end. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${item.hex}26, transparent 55%)`,
        }}
      />

      <div className="relative flex flex-1 flex-col">
        <div className="flex items-start gap-3">
          <LogoTile item={item} size={34} radius="rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-body font-semibold text-fg">
              {item.name}
            </div>
            <div className="text-ui-chip font-semibold tracking-wide text-fg-4 uppercase">
              {CATEGORY_LABELS[item.category]}
            </div>
          </div>
          <AddControl item={item} added={added} onAdd={onAdd} />
        </div>

        {/* Two reserved lines so 1- and 2-line descriptions leave cards
            the same height across a shelf. */}
        <p className="mt-2.5 line-clamp-2 min-h-9 text-ui-meta leading-relaxed text-fg-3">
          {item.description}
        </p>
      </div>
    </div>
  );
}
