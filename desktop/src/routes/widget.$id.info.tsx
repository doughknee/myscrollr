/**
 * Per-widget info page — `/widget/$id/info`.
 *
 * The catalog's "learn more" surface: clicking a catalog card opens this
 * page. It works for ANY widget id (data or utility) — the static `info`
 * segment wins over `/widget/$id/$tab`, so data widgets (which otherwise
 * live under /channel) resolve here too. Content comes from the catalog
 * item (name, brand color, real logo, description) + its source manifest's
 * about/usage. The primary CTA mirrors the catalog card's add/gating logic
 * via the shared useAddWidget hook, so adding here behaves identically.
 *
 * Built 2026-07-01 to pull "more info" out of Support and give each widget
 * a branded hero of its own.
 */
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import clsx from "clsx";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  PackageOpen,
  Plus,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

import { catalogItemById, readableTextOn, CATEGORY_LABELS } from "../marketplace";
import type { SubscriptionTier } from "../auth";
import { TIER_LABELS } from "../auth";
import { channelsApi } from "../api/client";
import type { ChannelType } from "../api/client";
import { dashboardQueryOptions, queryKeys } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";
import { useAddWidget } from "../hooks/useAddWidget";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { disableWidget } from "../preferences";
import PageLayout from "../components/layout/PageLayout";
import EmptySection from "../components/layout/EmptySection";
import RouteError from "../components/RouteError";

export const Route = createFileRoute("/widget/$id/info")({
  component: WidgetInfoPage,
  errorComponent: RouteError,
});

// ── Tier gating (mirrors CatalogCard) ───────────────────────────

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

// ── Page ────────────────────────────────────────────────────────

function WidgetInfoPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { prefs, tier, authenticated, onLogin } = useShell();
  const { channels } = useShellData();
  const { isLoading: dashboardLoading } = useQuery(dashboardQueryOptions());
  const addWidget = useAddWidget();
  const queryClient = useQueryClient();
  const undoable = useUndoableAction();
  const [removing, setRemoving] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const item = catalogItemById(id);
  const backToCatalog = () => navigate({ to: "/catalog" });

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
    item.kind === "data"
      ? channels.some((c) => c.channel_type === item.id)
      : prefs.widgets.enabledWidgets.includes(item.id);

  const tierLocked =
    authenticated &&
    item.requiredTier !== "free" &&
    !tierMeets(tier, item.requiredTier);

  // Enabled rows only — matches the server gate (WHERE enabled = true).
  const used =
    channels.filter((ch) => ch.enabled).length +
    prefs.widgets.enabledWidgets.length;
  const maxSlots = getMaxWidgets(tier);
  const slotLocked = used >= maxSlots && !enabled && !tierLocked;

  // Human slot counter for the actions area (v1.1.1 catalog redesign —
  // the info page is the transaction surface, so the plan context lives
  // here, not on catalog cards). Infinity = unlimited plans.
  const slotCounter = Number.isFinite(maxSlots)
    ? used === 0 && !enabled
      ? `0 of ${maxSlots} slots used — room for this one!`
      : `${used} of ${maxSlots} widget slots used`
    : `${used} widgets added · unlimited slots`;

  const removeWidget = async () => {
    if (item.kind === "data") {
      setRemoving(true);
      try {
        await channelsApi.delete(item.id as ChannelType);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        toast.success(`${item.name} removed`, {
          description: "Its slot is free for another widget.",
        });
      } catch (err) {
        console.error("[Scrollr] Remove failed:", err);
        toast.error(`Couldn't remove ${item.name}`);
      } finally {
        setRemoving(false);
      }
    } else {
      // Utilities live in prefs — undoable, settings preserved.
      undoable(
        {
          label: `Removed ${item.name}`,
          description: "Its slot is free for another widget.",
        },
        (current) => disableWidget(current, item.id),
      );
    }
  };

  const openWidget = () => {
    if (item.kind === "data") {
      navigate({ to: "/channel/$type/$tab", params: { type: item.id, tab: "feed" } });
    } else {
      navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
    }
  };
  const configureWidget = () => {
    if (item.kind === "data") {
      navigate({ to: "/channel/$type/$tab", params: { type: item.id, tab: "configuration" } });
    } else {
      navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "configuration" } });
    }
  };

  // CTA for a widget that is NOT yet added (same gating order as the catalog
  // card). Added widgets render a Configure + Open pair instead — see below.
  let cta:
    | {
        label: string;
        onClick: () => void;
        icon?: LucideIcon;
        brand?: boolean;
        tone?: "accent" | "warn";
        disabled?: boolean;
      }
    | null = null;
  if (!enabled) {
    if (!authenticated && item.kind === "data") {
      cta = { label: "Sign in to add", onClick: onLogin, tone: "accent" };
    } else if (tierLocked) {
      cta = {
        label: `Requires ${TIER_LABELS[item.requiredTier]} — Upgrade`,
        onClick: () => open("https://myscrollr.com/uplink"),
        icon: ExternalLink,
        tone: "warn",
      };
    } else if (slotLocked) {
      cta = {
        label: "Upgrade for more slots",
        onClick: () => open("https://myscrollr.com/uplink"),
        icon: ExternalLink,
        tone: "warn",
      };
    } else {
      cta = {
        label: `Add ${item.name}`,
        onClick: () => {
          void addWidget(item);
        },
        icon: Plus,
        brand: true,
        disabled: dashboardLoading && item.kind === "data",
      };
    }
  }
  const CtaIcon = cta?.icon;

  return (
    <PageLayout title={item.name} parentLabel="Catalog" onParentClick={backToCatalog}>
      <div className="flex flex-col gap-6">
        {/* Branded hero — bold widget color + real logo tile. */}
        <div
          className="relative overflow-hidden rounded-2xl p-6 shadow-soft-sm"
          style={{ backgroundColor: item.hex }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/20" />
          <div className="relative flex items-center gap-4">
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
        </div>

        {/* Lead description */}
        <p className="text-ui-body leading-relaxed text-fg-2">{item.description}</p>

        {/* About */}
        {item.info.about && (
          <section>
            <h2 className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
              About
            </h2>
            <p className="mt-2 text-ui-body leading-relaxed text-fg-2">
              {item.info.about}
            </p>
          </section>
        )}

        {/* How to use */}
        {item.info.usage.length > 0 && (
          <section>
            <h2 className="text-ui-meta font-semibold uppercase tracking-wide text-fg-4">
              How to use it
            </h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {item.info.usage.map((point, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-ui-body leading-relaxed text-fg-2"
                >
                  <span
                    className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${item.hex}22`, color: item.hex }}
                  >
                    <Check size={11} strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Tier note (when locked-but-explained or simply premium) */}
        {item.requiredTier !== "free" && !enabled && (
          <p className="text-ui-meta text-fg-4">
            Included with {TIER_LABELS[item.requiredTier]} and up.
          </p>
        )}

        {/* Slot context — the plan story lives here now, not on cards. */}
        <div className="flex flex-col gap-2 border-t border-edge/40 pt-5">
          <p className="text-ui-meta text-fg-4">{slotCounter}</p>
          {slotLocked && (
            <p className="text-ui-meta leading-relaxed text-fg-3">
              All your slots are in use. You can always swap — remove a
              widget you're not using to free its slot for this one, or
              upgrade for more.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {enabled ? (
            <>
              {/* Added: secondary "Configure" text button + primary "Open". */}
              <button
                onClick={configureWidget}
                className="rounded-lg px-3 py-2 text-ui-body font-semibold text-fg-2 transition-colors hover:bg-base-150/70 hover:text-fg-1"
              >
                Configure
              </button>
              <button
                onClick={openWidget}
                style={{ backgroundColor: item.hex, color: textOn }}
                className="group/btn flex items-center gap-1.5 rounded-lg px-4 py-2 text-ui-body font-semibold shadow-soft-sm transition-all duration-150 active:scale-[0.98] hover:brightness-110"
              >
                Open
                <ChevronRight
                  size={15}
                  className="transition-transform duration-200 group-hover/btn:translate-x-0.5"
                />
              </button>
              <button
                onClick={() => void removeWidget()}
                disabled={removing}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-ui-body font-medium text-fg-4 transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={14} />
                Remove
              </button>
            </>
          ) : cta ? (
            <button
              onClick={cta.onClick}
              disabled={cta.disabled}
              style={
                cta.brand && !cta.disabled
                  ? { backgroundColor: item.hex, color: textOn }
                  : undefined
              }
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-ui-body font-semibold shadow-soft-sm transition-all duration-150 active:scale-[0.98]",
                cta.brand && !cta.disabled && "hover:brightness-110",
                cta.tone === "accent" && "bg-accent/10 text-accent hover:bg-accent/[0.16]",
                cta.tone === "warn" && "bg-warn/15 text-warn hover:bg-warn/25",
                cta.disabled && "cursor-not-allowed bg-base-200/60 text-fg-4",
              )}
            >
              {CtaIcon && <CtaIcon size={15} />}
              {cta.label}
            </button>
          ) : null}
          <button
            onClick={backToCatalog}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-ui-body font-medium text-fg-3 transition-colors hover:bg-base-150/60"
          >
            <ArrowLeft size={15} /> Back to catalog
          </button>
        </div>
      </div>
    </PageLayout>
  );
}
