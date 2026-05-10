/**
 * Unified Sports league manager — replaces MyLeagues + LeagueCatalog
 * with one list. Every catalog league appears as a row; click the
 * row to add or remove. Tracked rows show live/game status + the
 * favorite-team picker; untracked rows show a quiet "+" affordance.
 *
 * Same layout shape as Finance's SymbolManager — the chrome is
 * pinned (header, controls, filter chips), the list scrolls inside
 * a fixed pane.
 */
import { useMemo, useState, useCallback } from "react";
import {
  Plus,
  Check,
  Search as SearchIcon,
  X,
  Star,
  Trophy,
} from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import Tooltip from "../../components/Tooltip";
import UpgradePrompt from "../../components/UpgradePrompt";
import EmptySection from "../../components/layout/EmptySection";
import CategoryFilter from "../rss/CategoryFilter";
import { sportsTeamsOptions } from "../../api/queries";
import { formatCountdown } from "../../utils/gameHelpers";
import type { TrackedLeague, TeamInfo } from "../../api/queries";
import type { FavoriteTeam } from "../../hooks/useSportsConfig";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface LeagueManagerProps {
  leagues: string[];
  catalog: TrackedLeague[];
  favoriteTeams: Record<string, FavoriteTeam>;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onSetFavoriteTeam: (league: string, team: FavoriteTeam | null) => void;
  loading: boolean;
  error: boolean;
  maxLeagues: number;
  subscriptionTier: SubscriptionTier;
  saving: boolean;
}

type SortKey = "default" | "name" | "category" | "live";

// ── Component ────────────────────────────────────────────────────

export default function LeagueManager({
  leagues,
  catalog,
  favoriteTeams,
  onAdd,
  onRemove,
  onSetFavoriteTeam,
  loading,
  error,
  maxLeagues,
  subscriptionTier,
  saving,
}: LeagueManagerProps) {
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("default");

  const trackedSet = useMemo(() => new Set(leagues), [leagues]);
  const atLimit = leagues.length >= maxLeagues;

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of catalog) {
      if (l.category) map.set(l.category, (map.get(l.category) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [catalog]);

  const filtered = useMemo(() => {
    let list = catalog;
    if (trackedOnly) list = list.filter((l) => trackedSet.has(l.name));
    if (selectedCategories.size > 0) {
      list = list.filter((l) => selectedCategories.has(l.category));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q) ||
          l.country.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "category":
        sorted.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.name.localeCompare(b.name),
        );
        break;
      case "live":
        sorted.sort((a, b) => {
          if (a.live_count !== b.live_count) return b.live_count - a.live_count;
          if (a.game_count !== b.game_count) return b.game_count - a.game_count;
          return a.name.localeCompare(b.name);
        });
        break;
      case "default":
      default: {
        // Tracked first (in user's order), then untracked: live > games > alpha.
        const order = new Map(leagues.map((n, i) => [n, i]));
        sorted.sort((a, b) => {
          const aT = trackedSet.has(a.name);
          const bT = trackedSet.has(b.name);
          if (aT && !bT) return -1;
          if (!aT && bT) return 1;
          if (aT && bT) {
            return (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0);
          }
          if (a.live_count !== b.live_count) return b.live_count - a.live_count;
          if (a.game_count !== b.game_count) return b.game_count - a.game_count;
          return a.name.localeCompare(b.name);
        });
        break;
      }
    }
    return sorted;
  }, [
    catalog,
    trackedOnly,
    selectedCategories,
    search,
    sort,
    trackedSet,
    leagues,
  ]);

  const toggleLeague = useCallback(
    (name: string) => {
      if (saving) return;
      if (trackedSet.has(name)) onRemove(name);
      else if (!atLimit) onAdd(name);
    },
    [trackedSet, atLimit, saving, onAdd, onRemove],
  );

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  if (error) {
    return (
      <EmptySection
        icon={X}
        title="Couldn't load the league catalog"
        description="Check your connection and try again."
      />
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 pb-5 min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-fg">Leagues</h3>
          <span
            className={clsx(
              "px-1.5 py-px rounded-full text-ui-chip font-medium tabular-nums",
              atLimit ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent",
            )}
          >
            {leagues.length}
            {maxLeagues !== Infinity && ` / ${maxLeagues}`}
          </span>
        </div>
        <p className="text-ui-meta text-fg-3 truncate">Click a row to add or remove</p>
      </div>

      {atLimit && (
        <div className="shrink-0">
          <UpgradePrompt
            current={leagues.length}
            max={maxLeagues}
            noun="leagues"
            tier={subscriptionTier}
          />
        </div>
      )}

      <div className="shrink-0 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <SearchIcon
            size={12}
             className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leagues, sports, countries..."
            className="w-full pl-7 pr-7 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/60 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-fg-4 hover:text-fg-2 hover:bg-surface-hover transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClearAll={() => setSelectedCategories(new Set())}
          alignRight
        />

        <Tooltip
          content={
            trackedOnly
              ? "Showing your leagues only — click to show all"
              : "Show only your leagues"
          }
        >
          <button
            onClick={() => setTrackedOnly((v) => !v)}
            aria-pressed={trackedOnly}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta cursor-pointer whitespace-nowrap",
              "transition-all duration-200 active:scale-95",
              trackedOnly
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
            )}
          >
            <Star
              size={11}
              className={clsx(
                "transition-transform duration-200",
                trackedOnly && "fill-current rotate-[20deg]",
              )}
            />
            <span>Tracked</span>
          </button>
        </Tooltip>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none"
          aria-label="Sort leagues"
        >
          <option value="default">Tracked first</option>
          <option value="name">Name</option>
          <option value="category">Sport</option>
          <option value="live">Live activity</option>
        </select>
      </div>

      {selectedCategories.size > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {Array.from(selectedCategories).map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-ui-chip text-accent hover:bg-accent/25 transition-colors cursor-pointer"
            >
              {cat}
              <X size={10} className="opacity-60" />
            </button>
          ))}
          <button
            onClick={() => setSelectedCategories(new Set())}
            className="px-2 py-0.5 text-ui-chip text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {loading ? (
        <div className="shrink-0 text-center py-8">
          <p className="text-ui-meta text-fg-3 animate-pulse">Loading catalog...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="shrink-0">
          <EmptySection
            icon={SearchIcon}
            title={trackedOnly ? "No tracked leagues match" : "No matches"}
            description={
              trackedOnly
                ? "Try clearing the tracked-only filter or your search."
                : "Try a different search or category."
            }
            compact
          />
        </div>
      ) : (
        <div
          role="list"
          className="flex-1 min-h-0 overflow-y-auto scrollbar-thin border border-edge/30 rounded-lg divide-y divide-edge/20"
        >
          {filtered.map((league) => (
            <LeagueRow
              key={league.name}
              league={league}
              tracked={trackedSet.has(league.name)}
              favorite={favoriteTeams[league.name]}
              atLimit={atLimit}
              saving={saving}
              onToggle={() => toggleLeague(league.name)}
              onSetFavoriteTeam={(team) => onSetFavoriteTeam(league.name, team)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

interface LeagueRowProps {
  league: TrackedLeague;
  tracked: boolean;
  favorite: FavoriteTeam | undefined;
  atLimit: boolean;
  saving: boolean;
  onToggle: () => void;
  onSetFavoriteTeam: (team: FavoriteTeam | null) => void;
}

function LeagueRow({
  league,
  tracked,
  favorite,
  atLimit,
  saving,
  onToggle,
  onSetFavoriteTeam,
}: LeagueRowProps) {
  const blocked = !tracked && atLimit;

  return (
    <div
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2 transition-all duration-150 group",
        tracked
          ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
          : blocked
            ? "opacity-40"
            : "hover:bg-base-200/50",
      )}
    >
      {/* Toggle area — clickable region for the row identity. The
          favorite-team picker on tracked rows is a sibling button so
          its clicks don't collide with the row toggle. */}
      <button
        type="button"
        onClick={onToggle}
        disabled={saving || blocked}
        aria-label={
          tracked
            ? `Remove ${league.name}`
            : blocked
              ? `${league.name} — at league limit`
              : `Add ${league.name}`
        }
        className={clsx(
          "flex items-center gap-2.5 flex-1 min-w-0 text-left transition-all duration-150 active:scale-[0.995]",
          blocked ? "cursor-not-allowed" : "cursor-pointer",
          saving && "cursor-wait",
        )}
      >
        <span
          className={clsx(
            "shrink-0 w-5 h-5 flex items-center justify-center rounded-md transition-colors",
            tracked
              ? "bg-accent/20 text-accent"
              : "bg-surface-hover text-fg-4 group-hover:text-fg-2",
          )}
        >
          <motion.span
            key={tracked ? "check" : "plus"}
            initial={{ scale: 0.4, opacity: 0, rotate: tracked ? -45 : 45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 24 }}
            className="flex items-center justify-center"
          >
            {tracked ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
          </motion.span>
        </span>

        <LeagueLogo url={league.logo_url} />

        <div className="flex-1 min-w-0">
          <span className="text-ui-body font-medium text-fg-2 truncate block">
            {league.name}
          </span>
          {league.country && (
            <span className="text-ui-meta text-fg-3 truncate block">
              {league.country}
            </span>
          )}
        </div>

        <span className="shrink-0 px-1.5 py-px rounded text-ui-chip text-fg-3 bg-surface-hover whitespace-nowrap">
          {league.category}
        </span>

        <div className="shrink-0 w-20 text-right">
          <LeagueStatus league={league} />
        </div>
      </button>

      {/* Favorite-team picker — only on tracked rows. Outside the
          toggle button so the picker's clicks don't toggle the row. */}
      {tracked && (
        <TeamPicker
          league={league.name}
          selected={favorite}
          onSelect={onSetFavoriteTeam}
          disabled={saving}
        />
      )}
    </div>
  );
}

// ── League logo ──────────────────────────────────────────────────

function LeagueLogo({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex items-center justify-center w-5 h-5 rounded-sm bg-[#f97316]/10 shrink-0">
        <Trophy size={12} className="text-[#f97316]/40" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="w-5 h-5 rounded-sm object-contain shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

// ── League status ────────────────────────────────────────────────

function LeagueStatus({ league }: { league: TrackedLeague }) {
  if (league.live_count > 0) {
    return (
      <span className="flex items-center justify-end gap-1 text-ui-chip text-live tabular-nums">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-live" />
        </span>
        {league.live_count} Live
      </span>
    );
  }
  if (league.game_count > 0) {
    return (
      <span className="text-ui-chip text-fg-3 tabular-nums">
        {league.game_count} game{league.game_count !== 1 ? "s" : ""}
      </span>
    );
  }
  if (league.is_offseason) {
    return <span className="text-ui-chip text-fg-3">Off-season</span>;
  }
  if (league.next_game) {
    return (
      <Tooltip content={`Next game: ${new Date(league.next_game).toLocaleString()}`}>
        <span className="text-ui-chip text-fg-3 tabular-nums">
          {formatCountdown(league.next_game)}
        </span>
      </Tooltip>
    );
  }
  return <span className="text-ui-chip text-fg-3">—</span>;
}

// ── Favorite team picker ─────────────────────────────────────────

function TeamPicker({
  league,
  selected,
  onSelect,
  disabled,
}: {
  league: string;
  selected: FavoriteTeam | undefined;
  onSelect: (team: FavoriteTeam | null) => void;
  disabled: boolean;
}) {
  const { data, isLoading } = useQuery(sportsTeamsOptions(league));
  const teams: TeamInfo[] = data?.teams ?? [];

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Tooltip content={selected ? `Favorite: ${selected.teamName}` : "Pick favorite team"}>
        <Star
          size={12}
          className={clsx(
            "shrink-0 transition-colors",
            selected ? "text-[#f97316] fill-[#f97316]" : "text-fg-3",
          )}
        />
      </Tooltip>
      <select
        value={selected?.teamId ?? ""}
        disabled={disabled || isLoading || teams.length === 0}
        onChange={(e) => {
          const id = Number(e.target.value);
          if (!id) {
            onSelect(null);
            return;
          }
          const team = teams.find((t) => t.external_id === id);
          if (team) onSelect({ teamId: team.external_id, teamName: team.name });
        }}
        className="px-1.5 py-0.5 rounded bg-base-200 border border-edge/30 text-ui-chip text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none max-w-[100px] disabled:opacity-40"
      >
        <option value="">{isLoading ? "Loading..." : "No team"}</option>
        {teams.map((t) => (
          <option key={t.external_id} value={t.external_id}>
            {t.name}
          </option>
        ))}
      </select>
      {selected && (
        <Tooltip content="Clear favorite">
          <button
            onClick={() => onSelect(null)}
            disabled={disabled}
            className="p-0.5 rounded hover:bg-[#f97316]/10 text-fg-3 hover:text-[#f97316] transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Clear favorite team"
          >
            <X size={10} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
