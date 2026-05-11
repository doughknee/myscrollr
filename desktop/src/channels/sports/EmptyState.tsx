/**
 * Sports-specific empty-state row for the home feed.
 *
 * Replaces the generic EmptyDataRow with context-aware messaging:
 * polling outages, off-season leagues, next-game countdown, or
 * "no leagues selected" CTA. Driven entirely by the LeagueMeta array
 * served alongside the games payload.
 */
import { Settings, AlertTriangle } from "lucide-react";
import { formatCountdown } from "../../utils/gameHelpers";
import type { LeagueMeta } from "../../api/queries";

interface SportsEmptyStateProps {
  /** User's selected leagues with their off-season / next-game / health status. */
  leagues: LeagueMeta[];
  /** Optional Configure CTA — only shown when leagues array is empty. */
  onConfigure?: () => void;
}

/**
 * Decision tree (top wins):
 *   1. leagues empty                  → "Pick leagues to follow" + CTA
 *   2. any polling_healthy=false      → "Live data unavailable: ..." (warning)
 *   3. all leagues is_offseason=true  → "Off-season — X returns in Yd"
 *   4. any league has next_game      → "Next: X • in Y"
 *   5. otherwise                      → "No games scheduled — check back later"
 */
export default function SportsEmptyState({ leagues, onConfigure }: SportsEmptyStateProps) {
  // Branch 1: no leagues selected
  if (leagues.length === 0) {
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">No leagues configured yet</p>
        {onConfigure && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfigure();
            }}
            className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            <Settings size={11} />
            Open Settings to pick your leagues
          </button>
        )}
      </div>
    );
  }

  // Branch 2: polling unhealthy on one or more leagues
  const unhealthy = leagues.filter((l) => !l.polling_healthy);
  if (unhealthy.length > 0) {
    const names = [...unhealthy.map((l) => l.name)].sort();
    const display =
      names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
    return (
      <div className="px-4 py-5 text-center" role="status" aria-live="polite">
        <p className="inline-flex items-center justify-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
          <AlertTriangle size={11} />
          Live data unavailable
        </p>
        <p className="text-[11px] text-fg-3">{display}</p>
      </div>
    );
  }

  // Branch 3: all leagues are off-season
  const allOffseason = leagues.every((l) => l.is_offseason);
  if (allOffseason) {
    const withNext = leagues
      .filter((l) => l.next_game != null)
      .sort((a, b) => +new Date(a.next_game!) - +new Date(b.next_game!));
    if (withNext.length > 0) {
      const target = withNext[0];
      return (
        <div className="px-4 py-5 text-center">
          <p className="text-xs text-fg-3 font-medium mb-1">All your leagues are off-season</p>
          <p className="text-[11px] text-fg-4">
            {target.name} returns {formatCountdown(target.next_game!)}
          </p>
        </div>
      );
    }
    // No next_game known — pick alphabetically first league
    const fallback = [...leagues].sort((a, b) => a.name.localeCompare(b.name))[0];
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">All your leagues are off-season</p>
        <p className="text-[11px] text-fg-4">{fallback.name} returns next season</p>
      </div>
    );
  }

  // Branch 4: some league has an upcoming game
  const withNext = leagues
    .filter((l) => l.next_game != null)
    .sort((a, b) => {
      const cmp = +new Date(a.next_game!) - +new Date(b.next_game!);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  if (withNext.length > 0) {
    const target = withNext[0];
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-xs text-fg-3 font-medium mb-1">No games right now</p>
        <p className="text-[11px] text-fg-4">
          Next: {target.name} • {formatCountdown(target.next_game!)}
        </p>
      </div>
    );
  }

  // Branch 5: in-season but nothing scheduled
  return (
    <div className="px-4 py-5 text-center">
      <p className="text-xs text-fg-3 font-medium">No games scheduled — check back later</p>
    </div>
  );
}
