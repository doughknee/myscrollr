import type { Game } from "../../types";
import GameChip from "../../components/chips/GameChip";
import { chipUrlForSports } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import {
  selectSportsForTicker,
  getSportsDisplayConfig,
  arrangeTickerSlots,
  TICKER_SLOTS,
} from "./view";
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
    const eligible = selectSportsForTicker(rows, config);
    const slots = arrangeTickerSlots(
      eligible,
      favorites,
      TICKER_SLOTS,
      ctx.cycles ?? {},
      `spo-${ctx.tab}`,
    );
    return slots.map(({ key, game, rotateSlot, reserveNames }) => ({
      key,
      rotateSlot,
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
