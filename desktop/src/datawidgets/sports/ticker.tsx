import type { Game } from "../../types";
import GameChip from "../../components/chips/GameChip";
import { chipUrlForSports } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectSportsForTicker, getSportsDisplayConfig } from "./view";
import { catalogItemById } from "../../marketplace";

/**
 * Sports ticker chips.
 *
 * Sports display prefs live server-side on the WIDGET row's config.display
 * (per-league toggles since the 000014 split), so the tab is passed through
 * to gate an NFL widget's chips by its own toggles.
 */
export const sportsTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const config = getSportsDisplayConfig(ctx.dashboard, ctx.tab);

    const rows = scopedRows<Game>(raw, ctx);
    // Each league is its own widget and the catalog gives it a brand colour
    // (F1 #e10600, NBA #c9082a, MLS #001838). The chip used to paint every
    // league the old single "sports channel" red; it now takes the widget's
    // own colour, as the catalog cards and Home ticker already do.
    const accent = catalogItemById(ctx.tab)?.hex;
    return selectSportsForTicker(rows, config).map((game) => ({
      key: `spo-${game.id}`,
      node: (
        <GameChip
          game={game}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          accent={accent}
          onClick={() =>
            ctx.onChipClick?.("sports", game.id, chipUrlForSports(game))
          }
        />
      ),
    }));
  },
};
