import type { Game } from "../../types";
import GameChip from "../../components/chips/GameChip";
import { chipUrlForSports } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectSportsForTicker, getSportsDisplayConfig } from "./view";
import { sportsDataWidget } from "./FeedTab";

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
    // One colour for every league: the sports widget's own orange. Per-league
    // brand tints were tried (catalogItemById(ctx.tab)?.hex, lifted for the
    // dark surface) and rejected on the rail -- a red F1 chip beside a blue
    // MLS one beside a red La Liga one read as noise, not identity, and the
    // league code in the tab already says which is which. The old
    // --color-secondary red was the pre-widgets "sports channel" colour and
    // never matched this manifest.
    const accent = sportsDataWidget.hex;
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
