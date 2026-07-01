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
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  PackageOpen,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

import { catalogItemById, readableTextOn, CATEGORY_LABELS } from "../marketplace";
import type { SubscriptionTier } from "../auth";
import { TIER_LABELS } from "../auth";
import { dashboardQueryOptions } from "../api/queries";
import { useShell, useShellData } from "../shell-context";
import { getMaxWidgets } from "../tierLimits";
import { useAddWidget } from "../hooks/useAddWidget";
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

  const used = channels.length + prefs.widgets.enabledWidgets.length;
  const slotLocked = used >= getMaxWidgets(tier) && !enabled && !tierLocked;

  const openWidget = () => {
    if (item.kind === "data") {
      navigate({
        to: "/channel/$type/$tab",
        params: { type: item.id, tab: "configuration" },
      });
    } else {
      navigate({ to: "/widget/$id/$tab", params: { id: item.id, tab: "feed" } });
    }
  };

  // Primary CTA — same gating order as the catalog card.
  let cta: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
    brand?: boolean;
    tone?: "accent" | "warn";
    disabled?: boolean;
  };
  if (enabled) {
    cta = {
      label: item.kind === "data" ? "Configure" : "Open",
      onClick: openWidget,
      icon: ChevronRight,
      brand: true,
    };
  } else if (!authenticated && item.kind === "data") {
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
      label: "Widget limit reached — Upgrade",
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
  const CtaIcon = cta.icon;

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

        {/* Actions */}
        <div className="flex items-center gap-3 border-t border-edge/40 pt-5">
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
