import ElectionChip from "../../components/chips/ElectionChip";
import { dropPinned, scopedRows, rotateSlots } from "../ticker";
import { followedRaceIds } from "./view";
import type { ElectionRace } from "./view";
import type { TickerContext, TickerSource } from "../ticker";

function chip(race: ElectionRace, ctx: TickerContext, key: string) {
  return {
    key,
    subject: String(race.id),
    pinLabel: race.name,
    node: <ElectionChip race={race} onClick={() => ctx.onChipClick?.("elections", race.id)} />,
  };
}

export const electionsTickerSource: TickerSource = {
  chips(raw, ctx) {
    const pool = dropPinned(scopedRows<ElectionRace>(raw, ctx), ctx, (r) => String(r.id));
    // Freeze the subject until the next lap but resolve its newest count on every update.
    const slots = rotateSlots(
      pool.map((r) => r.id),
      2,
      ctx.cycles ?? {},
      "elections",
      (id) => id,
      () => undefined,
      ctx.rotationMemo,
    );
    return slots.flatMap((s) => {
      const race = pool.find((r) => r.id === s.item);
      return race ? [{ ...chip(race, ctx, s.key), rotateSlot: s.rotateSlot }] : [];
    });
  },
  pinnedChip(raw, ctx) {
    const race = scopedRows<ElectionRace>(raw, ctx).find((r) => String(r.id) === ctx.pinnedSubject);
    return race ? chip(race, ctx, "pin-election-" + race.id) : null;
  },
  subjects(raw, ctx) {
    return scopedRows<ElectionRace>(raw, ctx).map((r) => ({ subject: String(r.id), label: r.name }));
  },
  status(raw, ctx) {
    if (!Array.isArray(raw)) return null;
    const config = ctx.dashboard?.widgets?.find((w) => w.widget_type === ctx.tab)?.config;
    return {
      tab: "RACES",
      text: followedRaceIds(config).length ? "Waiting for race data" : "Follow a race to see results",
      reserve: "Follow a race to see results",
    };
  },
};
