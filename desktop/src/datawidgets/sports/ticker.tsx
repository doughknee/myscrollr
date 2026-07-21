import type { Game } from "../../types";
import { shouldShowOnTicker } from "../../preferences";
import GameChip from "../../components/chips/GameChip";
import { chipUrlForSports } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectSportsForTicker, getSportsDisplayConfig } from "./view";

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
    const showLogos = shouldShowOnTicker(config.showLogos ?? "both");
    const showTimer = shouldShowOnTicker(config.showTimer ?? "both");

    const rows = scopedRows<Game>(raw, ctx);
    return selectSportsForTicker(rows, config).map((game) => ({
      key: `spo-${game.id}`,
      node: (
        <GameChip
          game={game}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          showLogos={showLogos}
          showTimer={showTimer}
          onClick={() =>
            ctx.onChipClick?.("sports", game.id, chipUrlForSports(game))
          }
        />
      ),
    }));
  },
};
