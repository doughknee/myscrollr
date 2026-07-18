import { Check, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Section } from "../../components/settings/SettingsControls";
import { sportLabel } from "./types";
import type { DiscoveredLeague } from "./types";

// ── Types ────────────────────────────────────────────────────────

export type ImportStatus = "pending" | "importing" | "done" | "error";

// ── Props ────────────────────────────────────────────────────────

interface ImportProgressProps {
  selectedKeys: Set<string>;
  discoveredLeagues: DiscoveredLeague[];
  importStatuses: Record<string, ImportStatus>;
  hex: string;
}

// ── Component ────────────────────────────────────────────────────

export function ImportProgress({
  selectedKeys,
  discoveredLeagues,
  importStatuses,
  hex,
}: ImportProgressProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Section title="Adding Leagues">
        <div className="px-3 space-y-1.5">
          {Array.from(selectedKeys).map((key) => {
            const league = discoveredLeagues.find(
              (l) => l.league_key === key,
            );
            const status = importStatuses[key] || "pending";
            const sport = sportLabel(league?.game_code || "");

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-edge/30 bg-base-250/30"
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {status === "done" && (
                    <Check size={14} className="text-success" />
                  )}
                  {status === "importing" && (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      style={{ color: hex }}
                    />
                  )}
                  {status === "pending" && (
                    <span className="h-2 w-2 rounded-full bg-fg-3/30" />
                  )}
                  {status === "error" && (
                    <span className="text-error text-[12px] font-bold">
                      !
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-fg-2 truncate">
                    {league?.name || key}
                  </p>
                  <p className="text-[11px] text-fg-3">
                    {sport} &middot; {league?.season}
                  </p>
                </div>
                <span
                  className="text-[10px] font-mono"
                  style={{
                    color:
                      status === "done"
                        ? "var(--color-success)"
                        : status === "importing"
                          ? hex
                          : status === "error"
                            ? "var(--color-error)"
                            : "var(--color-fg-3)",
                  }}
                >
                  {status === "done"
                    ? "Added"
                    : status === "importing"
                      ? "Adding..."
                      : status === "error"
                        ? "Failed"
                        : "Waiting"}
                </span>
              </motion.div>
            );
          })}
        </div>
      </Section>
    </motion.div>
  );
}
