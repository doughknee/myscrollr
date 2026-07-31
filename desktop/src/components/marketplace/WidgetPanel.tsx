/**
 * WidgetPanel — the catalog's slide-over detail view.
 *
 * Replaces navigating to /widget/$id/info from the catalog: browsing and
 * deciding are the same task, and a full page change threw away your
 * scroll position in a shelf you were halfway through. The route still
 * exists for deep links (sidebar menu, related-widget URLs); it now
 * redirects here.
 *
 * Focus handling copies ConfirmDialog rather than the two hand-rolled
 * role="dialog" overlays elsewhere in the app: a native <dialog> +
 * showModal() gives a real focus trap and inertness for free, and
 * onCancel + preventDefault routes Esc through our own close handler so
 * the URL stays in step. The scrim is our own motion.div — the UA
 * backdrop is made transparent — so it can animate with the panel.
 *
 * Panel state lives in the `?widget=` search param, so it deep-links,
 * survives reload, and puts Back where a user expects it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";

import type { CatalogItem } from "../../marketplace";
import { CATEGORY_LABELS, readableTextOn } from "../../marketplace";
import { slideOverMotion, backdropMotion } from "../../lib/motion";

// ── Props ───────────────────────────────────────────────────────

interface WidgetPanelProps {
  item: CatalogItem | null;
  added: boolean;
  /** Tier too low for this widget — offer an upgrade, not an add. */
  tierLocked: boolean;
  /** Slots full and this one isn't added — same. */
  slotLocked: boolean;
  authenticated: boolean;
  /** Same category, this widget excluded, capped by the caller. */
  related: CatalogItem[];
  onClose: () => void;
  onAdd: (item: CatalogItem) => void;
  onRemove: (item: CatalogItem) => void;
  onOpenWidget: (item: CatalogItem) => void;
  onSignIn: () => void;
  onUpgrade: () => void;
  /** Swap the panel in place when a related widget is picked. */
  onPick: (item: CatalogItem) => void;
}

// ── Ticker preview ──────────────────────────────────────────────
//
// Suggestive, not literal: the real chips need live data this surface
// does not have. A drifting row of brand-tinted placeholders answers the
// question the hero raises — "what does this look like once it's on?" —
// without pretending to quote a price.

function TickerPreview({ hex }: { hex: string }) {
  const widths = [86, 64, 104, 72, 92, 58];
  const chips = [...widths, ...widths];
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-edge/60 bg-surface-raised py-2">
      <div
        data-motion="marquee"
        style={{ "--marquee-duration": "14s" } as React.CSSProperties}
        className="flex w-max gap-2"
      >
        {chips.map((w, i) => (
          <div
            key={i}
            className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border px-2.5"
            style={{
              width: w,
              borderColor: `${hex}3d`,
              background: `${hex}10`,
            }}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: hex }}
            />
            <span
              className="h-[5px] flex-1 rounded-[3px] opacity-35"
              style={{ background: hex }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-ui-section text-fg-4">{children}</h3>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-edge/55 bg-surface-raised px-3 py-2.5">
      <div className="mb-0.5 font-mono text-ui-section text-fg-4">{label}</div>
      <div className="text-ui-meta font-semibold text-fg">{value}</div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function WidgetPanel({
  item,
  added,
  tierLocked,
  slotLocked,
  authenticated,
  related,
  onClose,
  onAdd,
  onRemove,
  onOpenWidget,
  onSignIn,
  onUpgrade,
  onPick,
}: WidgetPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const open = item !== null;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
  }, [open]);

  // A new widget in the same panel is a new logo; without this the
  // previous item's failure would suppress the next one's image.
  useEffect(() => setLogoFailed(false), [item?.id]);

  const textOn = useMemo(
    () => (item ? readableTextOn(item.hex) : "#fff"),
    [item],
  );

  return (
    <AnimatePresence onExitComplete={() => restoreRef.current?.focus()}>
      {open && item && (
        <motion.dialog
          ref={dialogRef}
          aria-label={`${item.name} details`}
          onCancel={(e) => {
            e.preventDefault();
            onClose();
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-[90] m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
        >
          <motion.div
            variants={backdropMotion}
            onClick={onClose}
            className="absolute inset-0 bg-fg/25"
          />

          <motion.aside
            variants={slideOverMotion}
            className="absolute inset-y-0 right-0 flex w-full max-w-[400px] flex-col overflow-hidden border-l border-edge/70 bg-surface shadow-soft-md"
          >
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              {/* ── Brand hero ────────────────────────────────── */}
              <div
                className="relative overflow-hidden p-5"
                style={{
                  background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}d8 100%)`,
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute top-3 right-3 flex size-[26px] cursor-pointer items-center justify-center rounded-[7px] bg-white/25"
                  style={{ color: textOn }}
                >
                  <X size={13} strokeWidth={2.5} />
                </button>

                <div className="flex items-center gap-3">
                  {/* Colour rides on the wrapper: the catalog's IconProps
                      has no `style`, so the glyph takes currentColor. */}
                  <span
                    className="flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-soft-sm"
                    style={{ color: item.hex }}
                  >
                    {item.logoUrl && !logoFailed ? (
                      <img
                        src={item.logoUrl}
                        alt=""
                        className="size-13 object-contain p-1.5"
                        onError={() => setLogoFailed(true)}
                      />
                    ) : (
                      <item.icon size={26} />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="font-mono text-ui-section opacity-75"
                      style={{ color: textOn }}
                    >
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    <span
                      className="text-[20px] leading-tight font-extrabold"
                      style={{ color: textOn }}
                    >
                      {item.name}
                    </span>
                  </span>
                </div>

                <p
                  className="mt-3 mb-3.5 text-[12.5px] leading-relaxed opacity-90"
                  style={{ color: textOn }}
                >
                  {item.description}
                </p>

                <div className="flex flex-wrap items-center gap-2.5">
                  {added ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenWidget(item)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-bold shadow-soft-sm"
                        style={{ color: item.hex }}
                      >
                        Open <ChevronRight size={13} strokeWidth={2.5} />
                      </button>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/22 px-2.5 py-1 text-ui-chip font-bold"
                        style={{ color: textOn }}
                      >
                        <Check size={11} strokeWidth={3} /> Added
                      </span>
                    </>
                  ) : !authenticated ? (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-bold shadow-soft-sm"
                      style={{ color: item.hex }}
                    >
                      Sign in to add
                    </button>
                  ) : tierLocked || slotLocked ? (
                    <button
                      type="button"
                      onClick={onUpgrade}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-bold text-warn shadow-soft-sm"
                    >
                      {tierLocked
                        ? `Upgrade to ${item.requiredTier.replace(/_/g, " ")}`
                        : "Upgrade for more slots"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAdd(item)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-bold shadow-soft-sm"
                      style={{ color: item.hex }}
                    >
                      <Plus size={13} strokeWidth={2.5} /> Add {item.name}
                    </button>
                  )}
                </div>
              </div>

              {/* ── Ticker preview ────────────────────────────── */}
              <div className="px-5 pt-4">
                <SectionLabel>In your ticker</SectionLabel>
                <TickerPreview hex={item.hex} />
              </div>

              {/* ── Facts ─────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-2 px-5 pt-3.5">
                <Fact label="Slot cost" value="1 slot · unlimited items" />
                <Fact
                  label="Plan"
                  value={
                    item.requiredTier === "free"
                      ? "Every plan"
                      : item.requiredTier.replace(/_/g, " ")
                  }
                />
              </div>

              {/* ── About ─────────────────────────────────────── */}
              {item.info.about && (
                <div className="px-5 pt-4">
                  <SectionLabel>About</SectionLabel>
                  <p className="text-[12.5px] leading-relaxed text-fg-2">
                    {item.info.about}
                  </p>
                </div>
              )}

              {/* ── How to use it ─────────────────────────────── */}
              {(item.info.usage?.length ?? 0) > 0 && (
                <div className="px-5 pt-4">
                  <SectionLabel>How to use it</SectionLabel>
                  <div className="flex flex-col gap-1.5">
                    {(item.info.usage ?? []).map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-[10px] border border-edge/50 bg-surface-raised px-3 py-2.5"
                      >
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-full text-ui-chip font-bold"
                          style={{
                            background: `${item.hex}1f`,
                            color: item.hex,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span className="text-ui-meta leading-relaxed text-fg-2">
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Remove ────────────────────────────────────── */}
              {added && (
                <div className="mx-5 mt-4 flex items-center justify-between gap-2.5 rounded-[10px] border border-edge/50 bg-surface-raised px-3 py-2.5">
                  <span className="text-ui-meta text-fg-4">
                    Removing frees the slot instantly.
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] bg-error/8 px-2.5 py-1.5 text-ui-chip font-semibold text-error hover:bg-error/15"
                  >
                    <Trash2 size={11} /> Remove
                  </button>
                </div>
              )}

              {/* ── More like this ────────────────────────────── */}
              {related.length > 0 && (
                <div className="px-5 pt-4.5 pb-5">
                  <SectionLabel>More like this</SectionLabel>
                  <div className="flex flex-col gap-1.5">
                    {related.map((rel) => (
                      <button
                        key={rel.id}
                        type="button"
                        onClick={() => onPick(rel)}
                        className={clsx(
                          "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-edge/50 bg-surface-raised px-3 py-2 text-left",
                          "hover:border-edge",
                        )}
                      >
                        <span
                          className="flex size-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] text-white"
                          style={{
                            background: `linear-gradient(135deg, ${rel.hex} 0%, ${rel.hex}b8 100%)`,
                          }}
                        >
                          <rel.icon size={14} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-ui-meta font-semibold text-fg">
                            {rel.name}
                          </span>
                          <span className="font-mono text-ui-section text-fg-4">
                            {CATEGORY_LABELS[rel.category]}
                          </span>
                        </span>
                        <ChevronRight size={12} className="shrink-0 text-fg-4" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        </motion.dialog>
      )}
    </AnimatePresence>
  );
}
