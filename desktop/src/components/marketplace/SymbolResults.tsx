/**
 * SymbolResults — the catalog search's "Symbols" block (SCROLLR-285).
 *
 * One row per matching symbol: "Add AAPL to your Stocks". One click writes
 * the symbol into that widget's watchlist, or creates the widget holding
 * just that symbol when the user has none yet. The write path is the
 * watchlist's own (`useDataWidgetConfig`), so tier-limit errors, the
 * optimistic update and the toast behave exactly as they do in Configure.
 */
import { Check, Plus } from "lucide-react";

import type { CatalogItem } from "../../marketplace";
import type { DataWidgetRow } from "../../api/client";
import { useDataWidgetConfig } from "../../hooks/useDataWidgetConfig";
import { LogoTile } from "./CatalogCard";
import { planSymbolAdd, symbolLabel } from "./symbolMatches";
import type { SymbolGroup } from "./symbolMatches";

export interface SymbolResultsProps {
  groups: SymbolGroup[];
  /** The user's data-widget rows: a widget they have, with its watchlist. */
  widgets: readonly DataWidgetRow[];
  /** Creating this widget is blocked: signed out, tier, or the plan is full. */
  gated: (item: CatalogItem) => boolean;
  /** No widget yet and the way is clear: create it with just this symbol. */
  onCreate: (
    item: CatalogItem,
    config: Record<string, unknown>,
    label: string,
  ) => void;
  /** Blocked: take the usual path (the widget's panel, with the upgrade). */
  onGate: (item: CatalogItem) => void;
}

function GroupRows({
  group,
  row,
  gated,
  onCreate,
  onGate,
}: {
  group: SymbolGroup;
  row: DataWidgetRow | undefined;
  gated: boolean;
  onCreate: SymbolResultsProps["onCreate"];
  onGate: SymbolResultsProps["onGate"];
}) {
  const { item } = group;
  const { saving, updateItems } = useDataWidgetConfig<string[]>(
    item.id,
    "symbols",
  );

  return (
    <>
      {group.hits.map((hit) => {
        const label = symbolLabel(hit.symbol);
        const plan = planSymbolAdd({ symbol: hit.symbol, item, row, gated });
        const act = () => {
          if (plan.kind === "append") updateItems(plan.symbols);
          else if (plan.kind === "create") onCreate(item, plan.config, label);
          else if (plan.kind === "gate") onGate(item);
        };
        return (
          <div
            key={hit.symbol}
            className="flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-base-150"
          >
            <LogoTile item={item} size={26} radius="rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col leading-4">
              <span className="truncate font-mono text-[12.5px] font-semibold text-fg">
                {label}
              </span>
              <span className="truncate text-ui-chip text-fg-4">{hit.name}</span>
            </span>
            {plan.kind === "on-list" ? (
              <span className="flex shrink-0 items-center gap-1 rounded-[7px] bg-accent/14 px-2 py-1 text-ui-chip font-semibold whitespace-nowrap text-accent">
                <Check size={12} strokeWidth={3} />
                On your {item.name}
              </span>
            ) : (
              <button
                type="button"
                onClick={act}
                disabled={saving}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[7px] border border-edge/70 px-2 py-1 text-ui-chip font-semibold whitespace-nowrap text-accent hover:border-accent/50 hover:bg-accent/10 disabled:opacity-50"
              >
                <Plus size={12} strokeWidth={2.5} />
                Add {label} to your {item.name}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function SymbolResults({
  groups,
  widgets,
  gated,
  onCreate,
  onGate,
}: SymbolResultsProps) {
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <div className="mb-5" data-testid="symbol-results">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <h1 className="text-[16px] leading-[22px] font-bold text-fg">Symbols</h1>
        <span className="text-ui-meta whitespace-nowrap text-fg-4">
          {total} match{total === 1 ? "" : "es"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {groups.map((group) => (
          <GroupRows
            key={group.item.id}
            group={group}
            row={widgets.find((w) => w.widget_type === group.item.id)}
            gated={gated(group.item)}
            onCreate={onCreate}
            onGate={onGate}
          />
        ))}
      </div>
    </div>
  );
}
