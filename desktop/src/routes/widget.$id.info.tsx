/**
 * Per-widget info page — `/widget/$id/info`.
 *
 * The catalog's product page (v1.1.1 round-3 redesign): the catalog grid
 * is browse-only, so THIS page owns the whole story — branded hero with
 * the primary action, a live-feeling ticker preview, quick facts, usage
 * steps, the plan/slot context, Remove, and related widgets to keep the
 * browse going. Works for ANY widget id (data or utility) — the static
 * `info` segment wins over the widget index route.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import clsx from "clsx";
import {
  Check,
  ChevronRight,
  ExternalLink,
  Layers,
  PackageOpen,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

import {
  catalogItemById,
  getCatalogItems,
  readableTextOn,
  CATEGORY_LABELS,
} from "../marketplace";
import type { CatalogItem } from "../marketplace";
import type { SubscriptionTier } from "../auth";
import { TIER_LABELS } from "../auth";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";
import { useCatalog } from "../hooks/useCatalog";
import { useAddWidget } from "../hooks/useAddWidget";
import { useRemoveWidget } from "../hooks/useRemoveWidget";
import PageLayout from "../components/layout/PageLayout";
import EmptySection from "../components/layout/EmptySection";
import RouteError from "../components/RouteError";

export const Route = createFileRoute("/widget/$id/info")({
  component: WidgetInfoPage,
  errorComponent: RouteError,
});

// ── Tier gating (mirrors the add flow) ──────────────────────────

const TIER_ORDER: SubscriptionTier[] = [
  "free",
  "uplink",
  "uplink_pro",
  "uplink_ultimate",
  "super_user",
];

function tierMeets(current: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(current) >= TIER_ORDER.indexOf(required);
}

// ── Shared entrance (Support-hub timing) ────────────────────────

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
function enter(index: number) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.28, delay: 0.05 + index * 0.06, ease: EASE },
  };
}

// ── Page ────────────────────────────────────────────────────────

function WidgetInfoPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { prefs, tier, authenticated, onLogin } = useShell();
  const { widgets } = useShellData();
  const { isLoading: dashboardLoading } = useQuery(dashboardQueryOptions());
  const addWidget = useAddWidget();
  const removeWidgetShared = useRemoveWidget();
  const [removing, setRemoving] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // Subscribing is what makes the read below re-run: a catalog swap has to
  // re-render this component or it keeps rendering the pre-refresh catalog.
  useCatalog();

  const item = catalogItemById(id);
  const backToCatalog = () => navigate({ to: "/catalog" });

  // "More like this" — same category, excluding this widget.
  const related = useMemo(() => {
    if (!item) return [];
    return getCatalogItems()
      .filter((it) => it.category === item.category && it.id !== item.id)
      .slice(0, 3);
  }, [item]);

  if (!item) {
    return (
      <PageLayout title="Widget" parentLabel="Catalog" onParentClick={backToCatalog}>
        <EmptySection
          icon={PackageOpen}
          title="Widget not found"
          description="This widget isn’t in the catalog. It may have been renamed or removed."
        />
      </PageLayout>
    );
  }

  const Icon = item.icon;
  const textOn = readableTextOn(item.hex);

  const enabled =
    Boolean(item.source)
      ? widgets.some((c) => c.widget_type === item.id)
      : prefs.widgets.enabledWidgets.includes(item.id);

  const tierLocked =
    authenticated &&
    item.requiredTier !== "free" &&
    !tierMeets(tier, item.requiredTier);

  // Enabled rows only — matches the server gate (WHERE enabled = true).
  const used =
    widgets.filter((ch) => ch.enabled).length +
    prefs.widgets.enabledWidgets.length;
  const maxSlots = getMaxWidgets(tier);
  const slotLocked = used >= maxSlots && !enabled && !tierLocked;

  const slotCounter = Number.isFinite(maxSlots)
    ? used === 0 && !enabled
      ? `0 of ${maxSlots} slots used — room for this one!`
      : `${used} of ${maxSlots} widget slots used`
    : `${used} widgets added · unlimited slots`;

  // Shared flow (useRemoveWidget) — same behavior as the sidebar menu.
  const removeWidget = async () => {
    setRemoving(true);
    try {
      await removeWidgetShared(item);
    } finally {
      setRemoving(false);
    }
  };

  const openWidget = () =>
    navigate({ to: "/widget/$id", params: { id: item.id } });

  // Primary hero action for a widget that is NOT yet added.
  type HeroAction = {
    label: string;
    onClick: () => void;
    add?: boolean;
    external?: boolean;
    disabled?: boolean;
  };
  const primaryAction: HeroAction | null = !enabled
    ? !authenticated && Boolean(item.source)
      ? { label: "Sign in to add", onClick: onLogin }
      : tierLocked
        ? {
            label: `Requires ${TIER_LABELS[item.requiredTier]} — Upgrade`,
            onClick: () => void open("https://myscrollr.com/uplink"),
            external: true,
          }
        : slotLocked
          ? {
              label: "Upgrade for more slots",
              onClick: () => void open("https://myscrollr.com/uplink"),
              external: true,
            }
          : {
              label: `Add ${item.name}`,
              onClick: () => void addWidget(item),
              add: true,
              disabled: dashboardLoading && Boolean(item.source),
            }
    : null;

  // Fake-but-alive ticker preview chips, brand-tinted. Purely visual —
  // sells "this is what it feels like in your ticker".
  const previewChips = [
    { w: "5.5rem" },
    { w: "8rem" },
    { w: "6.5rem" },
    { w: "9rem" },
    { w: "7rem" },
  ];

  return (
    <PageLayout title={item.name} parentLabel="Catalog" onParentClick={backToCatalog}>
      <div className="flex flex-col gap-7">
        {/* ── Hero — the product moment ─────────────────────── */}
        <motion.div
          {...enter(0)}
          className="relative overflow-hidden rounded-2xl p-7 shadow-soft-sm"
          style={{ backgroundColor: item.hex }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/25" />
          {/* Watermark mark bleeding off the corner */}
          <span
            className="pointer-events-none absolute -bottom-10 -right-8 opacity-[0.14]"
            style={{ color: textOn }}
            aria-hidden
          >
            <Icon size={180} />
          </span>
          <div className="relative flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white shadow-soft-sm"
                style={{ color: item.hex }}
              >
                {item.logoUrl && !logoFailed ? (
                  <img
                    src={item.logoUrl}
                    alt=""
                    className="h-11 w-11 object-contain"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <Icon size={30} />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className="text-ui-chip font-semibold uppercase tracking-wide opacity-80"
                  style={{ color: textOn }}
                >
                  {CATEGORY_LABELS[item.category]}
                </div>
                <h1
                  className="mt-0.5 text-2xl font-bold leading-tight"
                  style={{ color: textOn }}
                >
                  {item.name}
                </h1>
              </div>
              {enabled && (
                <span
                  className="ml-auto flex shrink-0 items-center gap-1 self-start rounded-full bg-white/20 px-2.5 py-1 text-ui-chip font-semibold"
                  style={{ color: textOn }}
                >
                  <Check size={12} /> Added
                </span>
              )}
            </div>

            <p
              className="max-w-lg text-ui-body leading-relaxed opacity-90"
              style={{ color: textOn }}
            >
              {item.description}
            </p>

            {/* Primary action lives IN the hero — this is the buy box. */}
            <div className="flex flex-wrap items-center gap-3">
              {enabled ? (
                <>
                  <button
                    onClick={openWidget}
                    className="group/btn flex items-center gap-1.5 rounded-lg bg-white px-5 py-2.5 text-ui-body font-semibold shadow-soft-sm transition-all duration-150 active:scale-[0.98] hover:brightness-95"
                    style={{ color: item.hex }}
                  >
                    Open
                    <ChevronRight
                      size={15}
                      className="transition-transform duration-150 group-hover/btn:translate-x-0.5"
                    />
                  </button>
                </>
              ) : primaryAction ? (
                <button
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-lg bg-white px-5 py-2.5 text-ui-body font-semibold shadow-soft-sm transition-all duration-150 active:scale-[0.98] hover:brightness-95",
                    primaryAction.disabled && "cursor-not-allowed opacity-60",
                  )}
                  style={{ color: item.hex }}
                >
                  {primaryAction.add && <Plus size={15} />}
                  {primaryAction.label}
                  {primaryAction.external && <ExternalLink size={13} />}
                </button>
              ) : null}
              <span
                className="text-ui-meta font-medium opacity-75"
                style={{ color: textOn }}
              >
                {slotCounter}
              </span>
            </div>
          </div>
        </motion.div>

        {/* ── Ticker preview — what it feels like ───────────── */}
        <motion.div {...enter(1)} className="flex flex-col gap-2">
          <span className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
            In your ticker
          </span>
          <div className="relative overflow-hidden rounded-xl border border-edge/40 bg-base-150/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              {previewChips.map((chip, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.25 + i * 0.09, ease: EASE }}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5"
                  style={{
                    borderColor: `${item.hex}44`,
                    backgroundColor: `${item.hex}14`,
                    width: chip.w,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                    style={{ backgroundColor: item.hex }}
                  />
                  <span
                    className="h-1.5 flex-1 rounded-full opacity-40"
                    style={{ backgroundColor: item.hex }}
                  />
                </motion.div>
              ))}
              <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-base-100 to-transparent" />
            </div>
          </div>
        </motion.div>

        {/* ── Quick facts ────────────────────────────────────── */}
        <motion.div {...enter(2)} className="grid grid-cols-3 gap-3">
          {[
            {
              icon: Tag,
              label: "Category",
              value: CATEGORY_LABELS[item.category],
            },
            {
              icon: Layers,
              label: "Slot cost",
              value: "1 slot · unlimited items",
            },
            {
              icon: Sparkles,
              label: "Plan",
              value:
                item.requiredTier === "free"
                  ? "Every plan"
                  : `${TIER_LABELS[item.requiredTier]} and up`,
            },
          ].map((fact) => (
            <div
              key={fact.label}
              className="flex flex-col gap-1 rounded-xl border border-edge/35 bg-base-150/35 p-3.5"
            >
              <span className="flex items-center gap-1.5 text-ui-chip font-semibold uppercase tracking-wide text-fg-4">
                <fact.icon size={11} />
                {fact.label}
              </span>
              <span className="text-ui-meta font-medium text-fg-2">{fact.value}</span>
            </div>
          ))}
        </motion.div>

        {/* ── About ──────────────────────────────────────────── */}
        {item.info.about && (
          <motion.section {...enter(3)}>
            <h2 className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
              About
            </h2>
            <p className="mt-2 text-ui-body leading-relaxed text-fg-2">
              {item.info.about}
            </p>
          </motion.section>
        )}

        {/* ── How to use — numbered step cards ───────────────── */}
        {(item.info.usage?.length ?? 0) > 0 && (
          <motion.section {...enter(4)}>
            <h2 className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
              How to use it
            </h2>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {(item.info.usage ?? []).map((point, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.3 + i * 0.06, ease: EASE }}
                  className="flex items-start gap-3 rounded-xl border border-edge/35 bg-base-150/35 p-3.5"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ui-chip font-bold"
                    style={{ backgroundColor: `${item.hex}22`, color: item.hex }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-ui-meta leading-relaxed text-fg-2">{point}</span>
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}

        {/* ── Plan / swap / remove band ──────────────────────── */}
        <motion.div
          {...enter(5)}
          className="flex flex-col gap-3 rounded-xl border border-edge/35 bg-base-150/25 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-ui-meta text-fg-3">{slotCounter}</p>
            {enabled && (
              <button
                onClick={() => void removeWidget()}
                disabled={removing}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ui-meta font-medium text-fg-4 transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={13} />
                Remove
              </button>
            )}
          </div>
          {slotLocked && (
            <p className="text-ui-meta leading-relaxed text-fg-3">
              All your slots are in use. You can always swap — remove a widget
              you're not using to free its slot for this one, or{" "}
              <button
                onClick={() => void open("https://myscrollr.com/uplink")}
                className="font-semibold text-accent hover:underline"
              >
                upgrade for more
              </button>
              .
            </p>
          )}
          {enabled && (
            <p className="text-ui-meta leading-relaxed text-fg-4">
              Removing frees the slot instantly — you can swap widgets any time.
            </p>
          )}
        </motion.div>

        {/* ── More like this ─────────────────────────────────── */}
        {related.length > 0 && (
          <motion.section {...enter(6)}>
            <h2 className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
              More like this
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {related.map((rel: CatalogItem) => {
                const RelIcon = rel.icon;
                return (
                  <button
                    key={rel.id}
                    onClick={() =>
                      navigate({ to: "/widget/$id/info", params: { id: rel.id } })
                    }
                    className="group/rel flex items-center gap-2.5 rounded-xl border border-edge/35 bg-base-150/35 p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-edge/60 hover:shadow-soft-sm"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${rel.hex}20`, color: rel.hex }}
                    >
                      <RelIcon size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-ui-meta font-semibold text-fg-1">
                        {rel.name}
                      </span>
                      <span className="block truncate text-ui-chip text-fg-4">
                        {CATEGORY_LABELS[rel.category]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.section>
        )}
      </div>
    </PageLayout>
  );
}
