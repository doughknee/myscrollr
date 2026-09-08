import type { Game } from "../../types";
import GameChip from "../../components/chips/GameChip";
import { chipUrlForSports } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows, dropPinned } from "../ticker";
import {
  selectSportsForTicker,
  getSportsDisplayConfig,
  arrangeTickerSlots,
  gamesForTeam,
  widestShortName,
  TICKER_SLOTS,
} from "./view";
import { teamShortName } from "../../utils/teamShortName";
import { catalogItemById } from "../../marketplace";

/**
 * Sports ticker chips.
 *
 * Sports display prefs live server-side on the WIDGET row's config.display
 * (per-league toggles since the 000014 split), so the tab is passed through
 * to gate an NFL widget's chips by its own toggles.
 *
 * What the horizon admits is not what the rail shows. A favourite's game
 * is always on; everything else shares a fixed number of rotating slots
 * that cycle through the eligible pool one lap at a time. The slot keeps
 * its key and its width while its game changes, so the rail never grows,
 * shrinks or reflows as a slate fills up -- a busy MLB night is one chip
 * per slot, not thirty chips.
 */
export const sportsTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const config = getSportsDisplayConfig(ctx.dashboard, ctx.tab);
    const favorites = favoriteTeamsFor(ctx);

    const rows = scopedRows<Game>(raw, ctx);
    // Each league is its own widget and the catalog gives it a brand colour
    // (F1 #e10600, NBA #c9082a, MLS #001838). The chip used to paint every
    // league the old single "sports channel" red; it now takes the widget's
    // own colour, as the catalog cards and Home ticker already do.
    const accent = catalogItemById(ctx.tab)?.hex;
    // A pinned team's fixture is in the fixed zone; drop it from the tape
    // so the same game is not on the bar twice. Both sides are checked --
    // a fixture is about both teams (§8.5).
    const eligible = dropPinned(selectSportsForTicker(rows, config), ctx, (g) => [
      g.home_team_name,
      g.away_team_name,
    ]);
    const slots = arrangeTickerSlots(
      eligible,
      favorites,
      TICKER_SLOTS,
      ctx.cycles ?? {},
      `spo-${ctx.tab}`,
      ctx.rotationMemo,
    );
    return slots.map(({ key, game, rotateSlot, reserveNames }) => ({
      key,
      rotateSlot,
      // A game chip is about two subjects. The one a right-click offers is
      // the home team: it is the durable half of "who is playing at home
      // tonight", and offering both would need a submenu on a bar you are
      // meant to glance at. The away team is pinnable from the widget page.
      subject: game.home_team_name,
      pinLabel: teamShortName(game.league, game.home_team_name),
      node: (
        <GameChip
          game={game}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          accent={accent}
          reserveNames={reserveNames}
          onClick={() =>
            ctx.onChipClick?.("sports", game.id, chipUrlForSports(game))
          }
        />
      ),
    }));
  },

  pinnedChip(raw: unknown, ctx: TickerContext): TickerChip | null {
    const team = ctx.pinnedSubject;
    if (!team) return null;
    // No horizon and no day window: the pin IS the selection (§8.5).
    const mine = gamesForTeam(scopedRows<Game>(raw, ctx), team);
    const game = mine[0];
    if (!game) return null;
    return {
      key: `pin-spo-${ctx.tab}-${team}`,
      subject: team,
      pinLabel: teamShortName(game.league, team),
      node: (
        <GameChip
          game={game}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          accent={catalogItemById(ctx.tab)?.hex}
          // The pinned team is fixed; the opponent is not. Reserving the
          // widest opponent across its own fixtures is what keeps the chip
          // from resizing when tonight's final rolls to Sunday's fixture.
          reserveNames={{
            away: widestShortName(mine, (g) => g.away_team_name),
            home: widestShortName(mine, (g) => g.home_team_name),
          }}
          onClick={() =>
            ctx.onChipClick?.("sports", game.id, chipUrlForSports(game))
          }
        />
      ),
    };
  },

  subjects(raw: unknown, ctx: TickerContext) {
    const seen = new Map<string, string>();
    for (const g of scopedRows<Game>(raw, ctx)) {
      for (const name of [g.home_team_name, g.away_team_name]) {
        if (!seen.has(name)) seen.set(name, teamShortName(g.league, name));
      }
    }
    return [...seen].map(([subject, label]) => ({ subject, label }));
  },
};

/** The widget's favourite team names, from its stored config. */
function favoriteTeamsFor(ctx: TickerContext): ReadonlySet<string> {
  const config = ctx.dashboard?.widgets?.find((c) => c.widget_type === ctx.tab)
    ?.config as { favoriteTeams?: Record<string, { teamName?: string }> } | undefined;
  const set = new Set<string>();
  for (const ft of Object.values(config?.favoriteTeams ?? {})) {
    if (ft?.teamName) set.add(ft.teamName);
  }
  return set;
}
