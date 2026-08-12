/**
 * Injury-status change tracking for the "breaking injury" moment chip.
 *
 * A permanent injury chip is noise — by Sunday every manager already
 * knows who's out. The chip is only interesting while the news is NEW,
 * so it needs to know what a player's status was the last time we
 * looked, which nothing in the Yahoo payload tells us.
 *
 * Kept deliberately small: a player_key -> {status, week} map in
 * localStorage, owned by the ticker window. Not in AppPreferences —
 * this is derived cache, not a user setting, and it shouldn't sync,
 * export, or survive a prefs reset.
 *
 * Failure mode is "no chip", never a crash: a corrupt or unavailable
 * store degrades to an empty map and every status reads as unchanged.
 */

const KEY = "scrollr.fantasy.injuryWatch.v1";

interface Seen {
  status: string;
  week: number;
}

type SeenMap = Record<string, Seen>;

function read(): SeenMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as SeenMap;
  } catch {
    return {};
  }
}

function write(map: SeenMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota or a locked-down webview. The feature degrades to "never
    // breaking", which is the safe direction.
  }
}

/**
 * Record what we currently see, and report which players' statuses
 * changed since last look.
 *
 * Call once per chip build with every player that has a status. A
 * player is "breaking" when we have seen them before in THIS week with
 * a different status — a first sighting isn't news, it's just the first
 * time the app ran, and treating it as breaking would light up the
 * whole roster on a fresh install.
 *
 * Entries for other weeks are dropped, which doubles as the cleanup
 * path: the map can never grow past one week of players.
 */
export function reconcileInjuries(
  players: Array<{ player_key: string; status: string | null }>,
  week: number,
): Set<string> {
  const previous = read();
  const next: SeenMap = {};
  const breaking = new Set<string>();

  for (const p of players) {
    const status = p.status ?? "";
    next[p.player_key] = { status, week };
    const before = previous[p.player_key];
    if (!before || before.week !== week) continue;
    if (before.status !== status) breaking.add(p.player_key);
  }

  write(next);
  return breaking;
}
