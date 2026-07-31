/**
 * Home — the briefing.
 *
 * Was a flat, equal-weight list: one preview section per widget, each
 * the same size, in catalog order. That treats "Inter Miami are level in
 * the 71st" and "the clock says 3:36" as the same kind of fact.
 *
 * Now: a live mini-ticker, a greeting, a "Happening now" row for the few
 * things worth interrupting for, then a bento grid that groups by source
 * — Scores, Headlines, Markets, Fantasy, Kalshi, utility tiles.
 *
 * Four states fall out of the data rather than being modes: a busy slate
 * fills the hero row, a quiet one drops it, unconfigured widgets keep
 * their card but swap the body for one sentence and one CTA, and an
 * empty account gets the welcome. Cards never disappear — a widget you
 * added and haven't set up yet is still a widget you added.
 */
import { useCallback, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Newspaper,
  Plus,
  TrendingUp,
  Trophy,
} from "lucide-react";
import clsx from "clsx";
import RouteError from "../components/RouteError";
import { WidgetBar } from "../components/widget-bar/Bar";
import SectionNav from "../components/layout/SectionNav";
import PageLayout from "../components/layout/PageLayout";
import { useShell, useShellData } from "../shell-context";
import { useCatalog } from "../hooks/useCatalog";
import { useAddWidget } from "../hooks/useAddWidget";
import {
  widgetManifest,
  sourceForWidget,
  canonicalOrder,
  getCatalogItems,
  readableTextOn,
} from "../marketplace";
import { scopeSourceData } from "../utils/widgetScope";
import { WIDGET_ORDER } from "../widgets/registry";
import { getStore } from "../lib/store";
import { formatTemp, weatherCodeToIcon } from "../widgets/weather/types";
import { loadMonitors } from "../widgets/uptime/types";
import { loadRepoData } from "../widgets/github/types";
import {
  LS_CLOCK_FORMAT,
  LS_TIMER_STATE,
  LS_WEATHER_CITIES,
  LS_WEATHER_UNIT,
  LS_SYSMON_DATA,
} from "../constants";
import HomeTicker from "../components/home/HomeTicker";
import type { TickerChip } from "../components/home/HomeTicker";
import {
  Card,
  ChangeChip,
  EmptyBody,
  LiveDot,
  SetupBody,
} from "../components/home/briefing";
import type { CatalogItem } from "../marketplace";
import type { DataWidgetRow } from "../api/client";
import type {
  DataWidgetManifest,
  Game,
  HomeHighlight,
  Trade,
  WidgetManifest,
} from "../types";
import type { TempUnit } from "../preferences";
import type { SystemInfo } from "../hooks/useSysmonData";
import type { TimerState } from "../widgets/timer/types";
import type { SavedCity } from "../widgets/weather/types";

export const Route = createFileRoute("/feed")({
  component: HomePage,
  errorComponent: RouteError,
});

// ── Resolved widget ─────────────────────────────────────────────

interface Resolved {
  row: DataWidgetRow;
  manifest: DataWidgetManifest;
  /** Normalized, then scoped to this widget's own config. */
  data: unknown[];
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

// ── Page ────────────────────────────────────────────────────────

function HomePage() {
  const navigate = useNavigate();
  const shell = useShell();
  const { widgets, dashboard } = useShellData();
  const catalogVersion = useCatalog();
  const addWidget = useAddWidget();
  const { allWidgets, authenticated, onLogin } = shell;
  const enabledWidgets = shell.prefs.widgets.enabledWidgets;

  const openWidget = useCallback(
    (id: string) => void navigate({ to: "/widget/$id", params: { id } }),
    [navigate],
  );
  const openTickerSettings = useCallback(
    () => void navigate({ to: "/customize", search: { page: "ticker" } }),
    [navigate],
  );

  // canonicalOrder() stays INSIDE the memo with catalogVersion in the
  // deps — hoisting it to module scope pins the order to whatever the
  // bundled snapshot held at import, so a server-added widget sorts by a
  // stale index.
  const resolved = useMemo<Resolved[]>(() => {
    const order = canonicalOrder();
    return widgets
      .filter((r) => r.enabled)
      .map((row) => {
        const manifest = widgetManifest(row.widget_type) as
          | DataWidgetManifest
          | undefined;
        if (!manifest) return null;
        const source = sourceForWidget(row.widget_type);
        const raw = source
          ? ((dashboard?.data as Record<string, unknown> | undefined)?.[
              source
            ] ?? [])
          : [];
        const flat = manifest.normalizeHome
          ? manifest.normalizeHome(raw)
          : Array.isArray(raw)
            ? raw
            : [];
        return {
          row,
          manifest,
          data: scopeSourceData(source ?? "", flat, row.config ?? undefined),
        };
      })
      .filter((x): x is Resolved => x !== null)
      .sort(
        (a, b) =>
          order.indexOf(a.row.widget_type) - order.indexOf(b.row.widget_type),
      );
  }, [widgets, dashboard, catalogVersion]);

  const utilities = useMemo(
    () =>
      WIDGET_ORDER.map((id) =>
        enabledWidgets.includes(id)
          ? (allWidgets.find((w) => w.id === id) ?? null)
          : null,
      ).filter(Boolean) as WidgetManifest[],
    [enabledWidgets, allWidgets],
  );

  const bySource = useCallback(
    (s: string) => resolved.filter((r) => sourceForWidget(r.row.widget_type) === s),
    [resolved],
  );

  const sports = bySource("sports");
  const finance = bySource("finance");
  const rss = bySource("rss");
  const fantasy = bySource("fantasy");
  const predictions = bySource("predictions");

  const hasAnything = resolved.length > 0 || utilities.length > 0;

  // ── Happening now ─────────────────────────────────────────────
  //
  // Ask each source, keep the top three. Priority is fixed — live sport
  // outranks a market move, which outranks everything else — because
  // "most important" is not something a source can rank across sources.
  const highlights = useMemo(() => {
    const out: (HomeHighlight & { id: string; name: string; hex: string })[] = [];
    const collect = (list: Resolved[]) => {
      for (const r of list) {
        const h = r.manifest.highlight?.(r.data);
        if (h) {
          out.push({
            ...h,
            id: r.row.widget_type,
            name: r.manifest.name,
            hex: h.hex ?? r.manifest.hex,
          });
        }
      }
    };
    collect(sports);
    collect(finance);
    collect([...rss, ...fantasy, ...predictions]);
    return out.slice(0, 3);
  }, [sports, finance, rss, fantasy, predictions]);

  // ── Ticker chips ──────────────────────────────────────────────
  const chips = useMemo<TickerChip[]>(() => {
    const out: TickerChip[] = [];
    for (const r of sports) {
      const g = (r.data as Game[])[0];
      if (g)
        out.push({
          id: r.row.widget_type,
          hex: r.manifest.hex,
          text: `${g.away_team_code || g.away_team_name} ${g.away_team_score}–${g.home_team_score} ${g.home_team_code || g.home_team_name}`,
        });
    }
    for (const r of finance) {
      const t = (r.data as Trade[])[0];
      if (t)
        out.push({
          id: r.row.widget_type,
          hex: r.manifest.hex,
          text: `${t.symbol} ${Number(t.percentage_change ?? 0) >= 0 ? "+" : ""}${Number(t.percentage_change ?? 0).toFixed(1)}%`,
        });
    }
    for (const r of rss) {
      const item = (r.data as { title?: string }[])[0];
      if (item?.title)
        out.push({
          id: r.row.widget_type,
          hex: r.manifest.hex,
          text: item.title.slice(0, 42),
        });
    }
    for (const u of utilities) {
      const v = getWidgetValue(u.id);
      if (v) out.push({ id: u.id, hex: u.hex, text: v });
    }
    return out;
  }, [sports, finance, rss, utilities]);

  // A widget that returned no rows AND owns a config is unconfigured —
  // distinct from a zero-config source that simply has nothing on right
  // now. Sports/news/predictions never appear here.
  const needsSetup = useMemo(
    () =>
      [...finance, ...fantasy].filter((r) => r.data.length === 0),
    [finance, fantasy],
  );

  // ── First run ─────────────────────────────────────────────────
  if (!hasAnything) {
    return (
      <PageLayout title="Home" width="wide" noTopPadding>
        <WidgetBar>
          <SectionNav active="home" />
        </WidgetBar>
        <FirstRun
          authenticated={authenticated}
          onLogin={onLogin}
          onAdd={(id) => {
            const item = getCatalogItems().find((i) => i.id === id);
            if (item) void addWidget(item);
          }}
          onBrowse={() => void navigate({ to: "/catalog" })}
        />
      </PageLayout>
    );
  }

  const now = new Date();
  const name = shell.prefs.widgets ? undefined : undefined;

  return (
    <PageLayout title="Home" width="wide" noTopPadding>
      <WidgetBar>
        <HomeTicker
          chips={chips}
          onManage={openTickerSettings}
          onOpen={openWidget}
        />
      </WidgetBar>

      <div className="mx-auto w-full max-w-[1100px] pt-4 pb-8">
        {/* ── Greeting ─────────────────────────────────────── */}
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-[19px] leading-tight font-extrabold text-fg">
            Good {greeting(now)}
          </h1>
          <span className="text-ui-meta text-fg-4">
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </header>

        {/* ── Needs setup ──────────────────────────────────── */}
        {needsSetup.length > 0 && (
          <div className="mb-4 rounded-xl border border-warn/25 bg-warn/[0.06] px-3.5 py-2.5 text-ui-meta text-fg-2">
            {needsSetup.length} widget{needsSetup.length === 1 ? "" : "s"} need
            {needsSetup.length === 1 ? "s" : ""} a quick setup —{" "}
            <span className="font-semibold">
              {needsSetup.map((r) => r.manifest.name).join(", ")}
            </span>{" "}
            — they'll start scrolling the moment you configure them.
          </div>
        )}

        {/* ── Happening now ────────────────────────────────── */}
        {highlights.length > 0 && (
          <section className="mb-4">
            <div className="mb-2 flex items-center gap-1.5">
              <span data-motion="pulse" className="size-1.5 rounded-full bg-error" />
              <h2 className="font-mono text-ui-section text-fg-3">
                Happening now
              </h2>
            </div>
            <div
              className={clsx(
                "grid gap-3",
                highlights.length === 1
                  ? "grid-cols-1"
                  : highlights.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-3",
              )}
            >
              {highlights.map((h) => {
                const textOn = readableTextOn(h.hex);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => openWidget(h.id)}
                    className="flex cursor-pointer flex-col items-start gap-1.5 rounded-xl p-3.5 text-left"
                    style={{
                      background: `linear-gradient(135deg, ${h.hex} 0%, ${h.hex}d8 100%)`,
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="font-mono text-ui-section opacity-80"
                        style={{ color: textOn }}
                      >
                        {h.name}
                      </span>
                      {h.live && <LiveDot />}
                    </span>
                    <span
                      className="text-[16px] leading-tight font-extrabold tabular-nums"
                      style={{ color: textOn }}
                    >
                      {h.headline}
                    </span>
                    <span
                      className="text-ui-meta opacity-90"
                      style={{ color: textOn }}
                    >
                      {h.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Bento ────────────────────────────────────────── */}
        <BentoGrid
          sports={sports}
          finance={finance}
          rss={rss}
          fantasy={fantasy}
          predictions={predictions}
          utilities={utilities}
          openWidget={openWidget}
        />
      </div>
    </PageLayout>
  );
}

// ── Bento ───────────────────────────────────────────────────────
//
// 3fr / 2fr. Sections render only for widgets you actually added, and
// the grid collapses to one column when only one side has content —
// an empty right rail would read as something failing to load.

function BentoGrid({
  sports,
  finance,
  rss,
  fantasy,
  predictions,
  utilities,
  openWidget,
}: {
  sports: Resolved[];
  finance: Resolved[];
  rss: Resolved[];
  fantasy: Resolved[];
  predictions: Resolved[];
  utilities: WidgetManifest[];
  openWidget: (id: string) => void;
}) {
  const left = sports.length > 0 || rss.length > 0 || utilities.length > 0;
  const right =
    finance.length > 0 || fantasy.length > 0 || predictions.length > 0;

  return (
    <div
      className={clsx(
        "grid items-start gap-3.5",
        left && right ? "grid-cols-[3fr_2fr]" : "grid-cols-1",
      )}
    >
      {left && (
        <div className="flex flex-col gap-3.5">
          {sports.length > 0 && (
            <ScoresCard items={sports} openWidget={openWidget} />
          )}
          {rss.length > 0 && (
            <HeadlinesCard items={rss} openWidget={openWidget} />
          )}
          {utilities.length > 0 && (
            <UtilityTiles items={utilities} openWidget={openWidget} />
          )}
        </div>
      )}
      {right && (
        <div className="flex flex-col gap-3.5">
          {finance.length > 0 && (
            <MarketsCard items={finance} openWidget={openWidget} />
          )}
          {fantasy.length > 0 && (
            <FantasyCard items={fantasy} openWidget={openWidget} />
          )}
          {predictions.length > 0 && (
            <KalshiCard items={predictions} openWidget={openWidget} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Scores ──────────────────────────────────────────────────────

function ScoresCard({
  items,
  openWidget,
}: {
  items: Resolved[];
  openWidget: (id: string) => void;
}) {
  // Merged for reading, but each row still knows which widget owns it.
  const rows = items
    .flatMap((r) =>
      (r.data as Game[]).map((g) => ({ g, id: r.row.widget_type, tag: r.manifest.tabLabel })),
    )
    .sort((a, b) => {
      const p: Record<string, number> = { in: 0, pre: 1, final: 2 };
      return (p[a.g.state ?? ""] ?? 3) - (p[b.g.state ?? ""] ?? 3);
    })
    .slice(0, 5);

  return (
    <Card
      title="Scores"
      icon={<Trophy size={14} />}
      chips={items.map((r) => ({
        id: r.row.widget_type,
        label: r.manifest.tabLabel,
        onClick: () => openWidget(r.row.widget_type),
      }))}
    >
      {rows.length === 0 ? (
        <EmptyBody>No games right now.</EmptyBody>
      ) : (
        rows.map(({ g, id, tag }, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            onClick={() => openWidget(id)}
            className="flex w-full cursor-pointer items-center gap-3 border-t border-fg/7 px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover/40"
          >
            <span className="w-9 shrink-0 font-mono text-ui-chip text-fg-4">
              {tag}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-ui-meta text-fg">
              {g.away_team_name || g.away_team_code}{" "}
              <span className="font-semibold tabular-nums">
                {g.away_team_score} – {g.home_team_score}
              </span>{" "}
              {g.home_team_name || g.home_team_code}
            </span>
            {g.state === "in" ? (
              <span className="shrink-0 font-mono text-ui-chip font-bold text-error">
                {g.short_detail || "LIVE"}
              </span>
            ) : (
              <span className="shrink-0 text-ui-chip text-fg-4">
                {g.short_detail || g.status_short}
              </span>
            )}
          </button>
        ))
      )}
    </Card>
  );
}

// ── Headlines ───────────────────────────────────────────────────

function HeadlinesCard({
  items,
  openWidget,
}: {
  items: Resolved[];
  openWidget: (id: string) => void;
}) {
  const rows = items
    .flatMap((r) =>
      (r.data as { title?: string; published?: string }[]).map((a) => ({
        a,
        id: r.row.widget_type,
        src: r.manifest.tabLabel,
        hex: r.manifest.hex,
      })),
    )
    .slice(0, 4);

  return (
    <Card
      title="Headlines"
      icon={<Newspaper size={14} />}
      chips={items.map((r) => ({
        id: r.row.widget_type,
        label: r.manifest.tabLabel,
        onClick: () => openWidget(r.row.widget_type),
      }))}
    >
      {rows.length === 0 ? (
        <EmptyBody>No headlines yet.</EmptyBody>
      ) : (
        rows.map(({ a, id, src, hex }, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            onClick={() => openWidget(id)}
            className="flex w-full cursor-pointer items-center gap-2.5 border-t border-fg/7 px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover/40"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: hex }}
            />
            <span className="min-w-0 flex-1 truncate text-left text-ui-meta text-fg">
              {a.title}
            </span>
            <span className="shrink-0 text-ui-chip text-fg-4">{src}</span>
          </button>
        ))
      )}
    </Card>
  );
}

// ── Markets ─────────────────────────────────────────────────────

function MarketsCard({
  items,
  openWidget,
}: {
  items: Resolved[];
  openWidget: (id: string) => void;
}) {
  const rows = items
    .flatMap((r) =>
      (r.data as Trade[]).map((t) => ({ t, id: r.row.widget_type })),
    )
    .sort(
      (a, b) =>
        Math.abs(Number(b.t.percentage_change ?? 0)) -
        Math.abs(Number(a.t.percentage_change ?? 0)),
    )
    .slice(0, 6);

  const unconfigured = rows.length === 0;

  return (
    <Card
      title="Markets"
      icon={<TrendingUp size={14} />}
      footer={items.map((r) => (
        <button
          key={r.row.widget_type}
          type="button"
          onClick={() => openWidget(r.row.widget_type)}
          className="flex cursor-pointer items-center gap-0.5 text-ui-chip font-medium text-fg-3 hover:text-fg"
        >
          {r.manifest.tabLabel} watchlist
          <ArrowRight size={10} />
        </button>
      ))}
    >
      {unconfigured ? (
        <SetupBody
          message="Your watchlist is empty — add a few symbols and they'll start streaming."
          cta="Add symbols"
          onCta={() => openWidget(items[0].row.widget_type)}
        />
      ) : (
        rows.map(({ t, id }, i) => (
          <button
            key={`${id}-${i}`}
            type="button"
            onClick={() => openWidget(id)}
            className="flex w-full cursor-pointer items-center gap-3 border-t border-fg/7 px-3.5 py-2 first:border-t-0 hover:bg-surface-hover/40"
          >
            <span className="w-12 shrink-0 text-left font-mono text-ui-meta font-semibold text-fg">
              {t.symbol}
            </span>
            {/* The design shows a company-name column, but Trade
                carries only symbol/price/change — no name, and inventing
                a lookup here would put a second source of truth for
                ticker names in the Home route. The symbol does the
                identifying work. */}
            <span className="min-w-0 flex-1" />
            <span className="shrink-0 text-ui-meta tabular-nums text-fg-2">
              {Number(t.price).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <ChangeChip pct={Number(t.percentage_change ?? 0)} />
          </button>
        ))
      )}
    </Card>
  );
}

// ── Fantasy ─────────────────────────────────────────────────────

function FantasyCard({
  items,
  openWidget,
}: {
  items: Resolved[];
  openWidget: (id: string) => void;
}) {
  const first = items[0];
  const leagues = first.data as Record<string, unknown>[];

  return (
    <Card
      title={first.manifest.name}
      icon={<Activity size={14} />}
      chips={[
        {
          id: first.row.widget_type,
          label: "Open",
          onClick: () => openWidget(first.row.widget_type),
        },
      ]}
    >
      {leagues.length === 0 ? (
        <SetupBody
          message="Connect your Yahoo account to follow your matchups here."
          cta="Connect Yahoo"
          tone="brand"
          onCta={() => openWidget(first.row.widget_type)}
        />
      ) : (
        leagues.slice(0, 2).map((l, i) => (
          <button
            key={i}
            type="button"
            onClick={() => openWidget(first.row.widget_type)}
            className="flex w-full cursor-pointer flex-col gap-1 border-t border-fg/7 px-3.5 py-2.5 text-left first:border-t-0 hover:bg-surface-hover/40"
          >
            <span className="truncate text-ui-meta font-semibold text-fg">
              {String(l.league_name ?? l.name ?? "League")}
            </span>
            <span className="font-mono text-ui-chip tabular-nums text-fg-3">
              {String(l.my_score ?? l.team_points ?? "—")} –{" "}
              {String(l.opp_score ?? l.opponent_points ?? "—")}
            </span>
          </button>
        ))
      )}
    </Card>
  );
}

// ── Kalshi ──────────────────────────────────────────────────────

function KalshiCard({
  items,
  openWidget,
}: {
  items: Resolved[];
  openWidget: (id: string) => void;
}) {
  const first = items[0];
  const markets = (first.data as Record<string, unknown>[]).slice(0, 4);

  return (
    <Card
      title={first.manifest.name}
      icon={<Activity size={14} />}
      chips={[
        {
          id: first.row.widget_type,
          label: "Open",
          onClick: () => openWidget(first.row.widget_type),
        },
      ]}
    >
      {markets.length === 0 ? (
        <EmptyBody>No markets right now.</EmptyBody>
      ) : (
        markets.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() => openWidget(first.row.widget_type)}
            className="flex w-full cursor-pointer items-center gap-3 border-t border-fg/7 px-3.5 py-2.5 first:border-t-0 hover:bg-surface-hover/40"
          >
            <span className="min-w-0 flex-1 truncate text-left text-ui-meta text-fg">
              {String(m.title ?? m.question ?? m.ticker ?? "")}
            </span>
            <span className="shrink-0 font-mono text-ui-meta font-semibold tabular-nums text-fg">
              {m.yes_price != null ? `${Number(m.yes_price)}%` : "—"}
            </span>
          </button>
        ))
      )}
    </Card>
  );
}

// ── Utility tiles ───────────────────────────────────────────────

function UtilityTiles({
  items,
  openWidget,
}: {
  items: WidgetManifest[];
  openWidget: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {items.map((w) => {
        const value = getWidgetValue(w.id);
        // The six sentinel strings getWidgetValue returns when a widget
        // has nothing configured. Turning them into a CTA keeps the tile
        // in place rather than hiding a widget the user did add.
        const unset =
          value === "" ||
          value === "No cities" ||
          value === "No monitors" ||
          value === "No repos" ||
          value === "Waiting for data";
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => openWidget(w.id)}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-edge/55 bg-surface-raised px-3.5 py-3 text-left hover:border-edge"
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `${w.hex}1f`, color: w.hex }}
            >
              <w.icon size={15} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ui-chip text-fg-4">{w.name}</span>
              <span
                className={clsx(
                  "truncate text-[14px] font-bold",
                  unset ? "text-accent" : "text-fg",
                )}
              >
                {unset ? "Set it up →" : value}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── First run ───────────────────────────────────────────────────

const STARTERS: { id: string; blurb: string }[] = [
  { id: "finance_stocks", blurb: "Live quotes, zero setup." },
  { id: "predictions", blurb: "The news, in numbers." },
  { id: "clock", blurb: "Local time and world clocks." },
];

function FirstRun({
  authenticated,
  onLogin,
  onAdd,
  onBrowse,
}: {
  authenticated: boolean;
  onLogin: () => void;
  onAdd: (id: string) => void;
  onBrowse: () => void;
}) {
  // Narrow with a predicate rather than `!` at each use: the icon is a
  // component, and a non-null assertion cannot appear in a JSX tag name.
  const starters = STARTERS.map((s) => ({
    ...s,
    item: getCatalogItems().find((i) => i.id === s.id),
  })).filter((s): s is typeof s & { item: CatalogItem } => Boolean(s.item));

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col items-center px-6 py-14 text-center">
      <span className="text-[34px] leading-none font-extrabold text-accent italic">
        S
      </span>
      <h1 className="mt-3 text-[19px] font-extrabold text-fg">
        Welcome to Scrollr
      </h1>
      <p className="mt-1.5 text-ui-meta text-fg-3">
        Pick something to follow and it starts scrolling immediately.
      </p>

      {authenticated ? (
        <>
          <div className="mt-6 grid w-full grid-cols-3 gap-3">
            {starters.map(({ id, blurb, item }) => {
              const Icon = item.icon;
              return (
              <div
                key={id}
                className="flex flex-col items-start gap-2 rounded-xl border border-edge/55 bg-surface-raised p-3.5 text-left"
              >
                <span
                  className="flex size-9 items-center justify-center rounded-lg text-white"
                  style={{
                    background: `linear-gradient(135deg, ${item.hex} 0%, ${item.hex}b8 100%)`,
                  }}
                >
                  <Icon size={18} />
                </span>
                <span className="text-ui-body font-semibold text-fg">
                  {item.name}
                </span>
                <span className="text-ui-chip text-fg-4">{blurb}</span>
                <button
                  type="button"
                  onClick={() => onAdd(id)}
                  aria-label={`Add ${item.name}`}
                  className="mt-1 flex cursor-pointer items-center gap-1 rounded-[7px] bg-accent/12 px-2.5 py-1.5 text-ui-chip font-semibold text-accent hover:bg-accent/20"
                >
                  <Plus size={11} strokeWidth={2.5} /> Add
                </button>
              </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onBrowse}
            className="mt-5 cursor-pointer rounded-lg bg-accent px-4 py-2 text-ui-meta font-semibold text-surface hover:bg-accent/90"
          >
            Browse the full Catalog
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onLogin}
          className="mt-6 cursor-pointer rounded-lg bg-accent px-4 py-2 text-ui-meta font-semibold text-surface hover:bg-accent/90"
        >
          Sign in to get started
        </button>
      )}
    </div>
  );
}

function formatTimerDuration(ms: number): string {
  const totalSecs = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getTimerValue(): string {
  const state = getStore<TimerState | null>(LS_TIMER_STATE, null);
  if (!state) return "Idle";

  const elapsed = state.startedAt == null
    ? state.bankedMs
    : state.bankedMs + (Date.now() - state.startedAt);

  if (state.startedAt == null && elapsed <= 0) return "Idle";

  const ms = state.mode === "stopwatch"
    ? elapsed
    : Math.max(0, state.targetSecs * 1000 - elapsed);

  return formatTimerDuration(ms);
}

// ── Route ───────────────────────────────────────────────────────

function getWidgetValue(id: string): string {
  switch (id) {
    case "clock": {
      const format = getStore<string>(LS_CLOCK_FORMAT, "12h");
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: format === "12h",
      }).format(new Date());
    }
    case "timer":
      return getTimerValue();
    case "weather": {
      const cities = getStore<SavedCity[]>(LS_WEATHER_CITIES, []);
      const unit = getStore<string>(LS_WEATHER_UNIT, "fahrenheit") as TempUnit;
      if (cities.length === 0) return "No cities";
      const first = cities[0];
      if (!first.weather) return first.location.name;
      const temp = formatTemp(first.weather.temperature, unit, true);
      const icon = weatherCodeToIcon(first.weather.weatherCode);
      return `${icon} ${temp}`;
    }
    case "sysmon": {
      const info = getStore<SystemInfo | null>(LS_SYSMON_DATA, null);
      if (!info) return "Waiting for data";
      const parts = [`CPU ${Math.round(info.cpuUsage)}%`];
      if (info.memTotal > 0) {
        const ramPct = Math.round((info.memUsed / info.memTotal) * 100);
        parts.push(`RAM ${ramPct}%`);
      }
      if (info.gpuUsage != null) {
        parts.push(`GPU ${Math.round(info.gpuUsage)}%`);
      }
      return parts.join("  ·  ");
    }
    case "uptime": {
      const monitors = loadMonitors();
      if (monitors.length === 0) return "No monitors";
      const up = monitors.filter((m) => m.status === "up").length;
      const down = monitors.filter((m) => m.status !== "up").length;
      if (down > 0) return `${up} up / ${down} down`;
      return `${up} up`;
    }
    case "github": {
      const repos = loadRepoData();
      if (repos.length === 0) return "No repos";
      const passing = repos.filter((r) => r.status === "success").length;
      const failing = repos.filter((r) => r.status === "failure").length;
      if (failing > 0) return `${passing} passing / ${failing} failing`;
      return `${passing} passing`;
    }
    default:
      return "";
  }
}
