import { useCallback, useRef, useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { AnimatePresence } from "motion/react";
import type { FeedTabProps, WidgetManifest } from "../../types";
import { WidgetBar } from "../../components/widget-bar/Bar";
import {
  SelectMenu,
  type SelectOption,
} from "../../components/widget-bar/SelectMenu";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { MenuPanel, MenuRow, useDismiss } from "../../components/widget-bar/Menu";
import { FEED_CARD, FEED_CARD_STATIC } from "../../components/feedCard";
import { useShell } from "../../shell-context";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import type { SysmonTickerConfig, TempUnit } from "../../preferences";
import { useSysmonData } from "../../hooks/useSysmonData";
import { formatBytes, formatTemp, formatUptime } from "../../utils/format";
import { findCpuTemp, findGpuTemp, usageColor, usageColorClass, tempColorClass, formatFreq, formatWatts, formatRate } from "./utils";
import type { TempReading } from "./utils";

// ── Constants ───────────────────────────────────────────────────

const POLL_INTERVAL = 2000;

// ── Helpers ─────────────────────────────────────────────────────

// ── Detail line helper ──────────────────────────────────────────

/** Join non-null stat fragments with · separator. */
function DetailLine({ items }: { items: (string | null | undefined)[] }) {
  const filtered = items.filter(Boolean) as string[];
  if (filtered.length === 0) return null;
  return (
    <div className="text-xs font-mono text-fg-3 tabular-nums">
      {filtered.join(" \u00B7 ")}
    </div>
  );
}

// ── FeedTab Component ───────────────────────────────────────────

type StatKey = "cpu" | "memory" | "gpu" | "gpuPower";

const STAT_ROWS: { key: StatKey; label: string }[] = [
  { key: "cpu", label: "CPU usage" },
  { key: "memory", label: "Memory usage" },
  { key: "gpu", label: "GPU usage" },
  { key: "gpuPower", label: "GPU power draw" },
];

const REFRESH_OPTIONS: SelectOption<string>[] = [
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
];

const TEMP_OPTIONS: SegmentedOption<TempUnit>[] = [
  { value: "fahrenheit", label: "°F" },
  { value: "celsius", label: "°C" },
];

function SysmonFeedTab(props: FeedTabProps) {
  return (
    <div className="flex min-h-full flex-col">
      {props.mode === "comfort" && <SysmonBar />}
      <SysmonFeedBody {...props} />
    </div>
  );
}

function SysmonBar() {
  const { prefs, onPrefsChange } = useShell();
  const { config, update, setTicker } = useWidgetConfig("sysmon", prefs, onPrefsChange);
  return (
    // Standard bar grammar: Segmented first, content menus left,
    // config selects in the right cluster (matches clock/weather's
    // unit-first layout and uptime/github's right-side Refresh).
    <WidgetBar>
      <Segmented
        ariaLabel="Temperature unit"
        value={config.tempUnit}
        onChange={(v) => update({ tempUnit: v })}
        options={TEMP_OPTIONS}
      />
      <StatsMenu ticker={config.ticker} setTicker={setTicker} />
      <div className="ml-auto">
        <SelectMenu
          ariaLabel="Update speed"
          prefix="Every"
          value={String(config.refreshInterval)}
          options={REFRESH_OPTIONS}
          onChange={(v) => update({ refreshInterval: Number(v) })}
        />
      </div>
    </WidgetBar>
  );
}

/** Stats picker — checkbox rows over the shared Menu primitives.
 *  MultiSelectMenu doesn't fit: its empty selection means "all", while
 *  these are independent on/off toggles gating feed cards AND ticker chips. */
function StatsMenu({
  ticker,
  setTicker,
}: {
  ticker: SysmonTickerConfig;
  setTicker: (patch: Partial<SysmonTickerConfig>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const onCount = STAT_ROWS.filter(({ key }) => ticker[key]).length;

  return (
    <div ref={rootRef} className="relative shrink-0 rounded-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Choose stats"
        className={clsx(
          "flex cursor-pointer items-center gap-1 rounded-full border py-1 pl-2.5 pr-2 text-ui-meta font-medium transition-colors",
          open
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-edge/30 bg-base-150/60 text-fg-3 hover:text-fg-2",
        )}
      >
        <span>Stats</span>
        <span className="font-mono text-ui-chip tabular-nums text-fg-4">
          {onCount}/{STAT_ROWS.length}
        </span>
        <ChevronDown
          size={12}
          aria-hidden
          className={clsx(
            "shrink-0 transition-transform duration-150",
            open ? "rotate-180 text-accent/70" : "text-fg-4",
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <MenuPanel className="left-0 w-56">
            {STAT_ROWS.map(({ key, label }) => (
              <MenuRow
                key={key}
                role="menuitemcheckbox"
                selected={ticker[key]}
                onClick={() => setTicker({ [key]: !ticker[key] })}
              >
                {label}
              </MenuRow>
            ))}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

function SysmonFeedBody({ mode: feedMode }: FeedTabProps) {
  const compact = feedMode === "compact";
  const info = useSysmonData(POLL_INTERVAL);
  // Stat selection (2026-07-17 unification): the bar Stats menu gates
  // BOTH the feed cells and the ticker chips. (Config keys still live
  // under `ticker` for storage compatibility.)
  const { prefs } = useShell();
  const stats = prefs.widgets.sysmon.ticker;
  const tempUnit = prefs.widgets.sysmon.tempUnit;

  // ── Loading state ───────────────────────────────────────────
  if (!info) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12">
        <Activity size={28} className="text-fg-4/40" />
        <p className="text-xs text-fg-4">Loading system info&hellip;</p>
      </div>
    );
  }

  const memPct =
    info.memTotal > 0 ? (info.memUsed / info.memTotal) * 100 : 0;
  const cpuTemp = findCpuTemp(info.components);
  const gpuTemp = findGpuTemp(info.components);

  // ── Compact ─────────────────────────────────────────────────
  if (compact) {
    return (
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-mono font-semibold text-widget-sysmon/80 uppercase tracking-wider">
            System
          </span>
          <span className="text-xs font-mono text-fg-3">
            Running for {formatUptime(info.uptime)}
          </span>
        </div>

        <div className={clsx(FEED_CARD, FEED_CARD_STATIC, "flex items-center gap-3")}>
          {stats.cpu && (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-xs font-mono text-widget-sysmon/70 shrink-0">
                CPU
              </span>
              <span
                className={`text-sm font-mono font-semibold tabular-nums ${usageColorClass(info.cpuUsage)}`}
              >
                {Math.round(info.cpuUsage)}%
              </span>
            </div>
          )}
          {stats.memory && (
            <>
              {stats.cpu && <div className="w-px h-4 bg-widget-sysmon/10" />}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="text-xs font-mono text-widget-sysmon/70 shrink-0">
                  RAM
                </span>
                <span
                  className={`text-sm font-mono font-semibold tabular-nums ${usageColorClass(memPct)}`}
                >
                  {Math.round(memPct)}%
                </span>
              </div>
            </>
          )}
          {stats.gpu && (info.gpuUsage !== null || gpuTemp) && (
            <>
              <div className="w-px h-4 bg-widget-sysmon/10" />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-mono text-widget-sysmon/70">
                  GPU
                </span>
                {info.gpuUsage !== null ? (
                  <span
                    className={`text-sm font-mono font-semibold tabular-nums ${usageColorClass(info.gpuUsage)}`}
                  >
                    {Math.round(info.gpuUsage)}%
                  </span>
                ) : gpuTemp ? (
                  <span
                    className={`text-sm font-mono font-semibold tabular-nums ${tempColorClass(gpuTemp.temp, gpuTemp.critical)}`}
                  >
                    {formatTemp(gpuTemp.temp, tempUnit)}
                  </span>
                ) : null}
              </div>
            </>
          )}
          {stats.gpuPower && info.gpuPowerWatts !== null && (
            <>
              <div className="w-px h-4 bg-widget-sysmon/10" />
              <span className="text-sm font-mono font-semibold tabular-nums text-fg-2 shrink-0">
                {formatWatts(info.gpuPowerWatts)}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Comfort ─────────────────────────────────────────────────

  // Build GPU header subtitle: "NITRO+ RX 7900 XTX Vapor-X · 24 GB"
  const gpuSubtitle = info.gpuName
    ? info.gpuVramTotal
      ? `${info.gpuName} \u00B7 ${formatBytes(info.gpuVramTotal)}`
      : info.gpuName
    : null;

  return (
    <div className="p-4 space-y-3">
      {/* Header: device info + uptime */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-semibold text-widget-sysmon/80 uppercase tracking-wider">
            System Monitor
          </span>
          <span className="text-xs font-mono text-fg-3">
            Running for {formatUptime(info.uptime)}
          </span>
        </div>
        <div className="text-xs font-mono text-fg-2 truncate">
          {info.cpuName} &middot; {info.cpuCores} cores
        </div>
        {gpuSubtitle && (
          <div className="text-xs font-mono text-fg-2 truncate">
            {gpuSubtitle}
          </div>
        )}
        <div className="text-xs font-mono text-fg-3 truncate">
          {info.osName} &middot; {info.hostname}
        </div>
      </div>

      {/* Stats grid — cells follow the bar's stat selection (network
          has no toggle and is always on). A lone trailing cell spans
          both columns. */}
      <div className="grid grid-cols-2 gap-2">
        {(() => {
          const cells: { key: string; node: React.ReactNode }[] = [];
          if (stats.cpu) {
            cells.push({
              key: "cpu",
              node: (
                <>
                  <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
                    CPU
                  </span>
                  <div
                    className={`text-xl font-mono font-bold tabular-nums ${usageColorClass(info.cpuUsage)}`}
                  >
                    {Math.round(info.cpuUsage)}%
                  </div>
                  <div className="h-1.5 rounded-full bg-widget-sysmon/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, info.cpuUsage)}%`,
                        background: `linear-gradient(90deg, #34d399, ${usageColor(info.cpuUsage)})`,
                      }}
                    />
                  </div>
                  <DetailLine
                    items={[
                      info.cpuFreqMhz !== null ? formatFreq(info.cpuFreqMhz) : null,
                      cpuTemp ? formatTemp(cpuTemp.temp, tempUnit, true) : null,
                    ]}
                  />
                </>
              ),
            });
          }
          if (stats.memory) {
            cells.push({
              key: "memory",
              node: (
                <>
                  <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
                    Memory
                  </span>
                  <div
                    className={`text-xl font-mono font-bold tabular-nums ${usageColorClass(memPct)}`}
                  >
                    {Math.round(memPct)}%
                  </div>
                  <div className="h-1.5 rounded-full bg-widget-sysmon/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, memPct)}%`,
                        background: `linear-gradient(90deg, #34d399, ${usageColor(memPct)})`,
                      }}
                    />
                  </div>
                  <div className="text-xs font-mono text-fg-3 tabular-nums">
                    {formatBytes(info.memUsed)} / {formatBytes(info.memTotal)}
                  </div>
                </>
              ),
            });
          }
          if (stats.gpu) {
            cells.push({
              key: "gpu",
              node: (
                <>
                  <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
                    GPU
                  </span>
                  {info.gpuUsage !== null ? (
                    <>
                      <div
                        className={`text-xl font-mono font-bold tabular-nums ${usageColorClass(info.gpuUsage)}`}
                      >
                        {Math.round(info.gpuUsage)}%
                      </div>
                      <div className="h-1.5 rounded-full bg-widget-sysmon/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, info.gpuUsage)}%`,
                            background: `linear-gradient(90deg, #34d399, ${usageColor(info.gpuUsage)})`,
                          }}
                        />
                      </div>
                      <DetailLine
                        items={[
                          info.gpuClockMhz !== null
                            ? formatFreq(info.gpuClockMhz)
                            : null,
                          stats.gpuPower && info.gpuPowerWatts !== null
                            ? formatWatts(info.gpuPowerWatts)
                            : null,
                          gpuTemp ? formatTemp(gpuTemp.temp, tempUnit, true) : null,
                        ]}
                      />
                      {info.gpuVramTotal !== null && info.gpuVramUsed !== null && (
                        <div className="text-xs font-mono text-fg-3 tabular-nums">
                          {formatBytes(info.gpuVramUsed)} /{" "}
                          {formatBytes(info.gpuVramTotal)} Video memory
                        </div>
                      )}
                    </>
                  ) : gpuTemp ? (
                    <div
                      className={`text-xl font-mono font-bold tabular-nums ${tempColorClass(gpuTemp.temp, gpuTemp.critical)}`}
                    >
                      {formatTemp(gpuTemp.temp, tempUnit, true)}
                    </div>
                  ) : (
                    <div className="text-xs font-mono text-fg-4">No GPU detected</div>
                  )}
                </>
              ),
            });
          }
          cells.push({
            key: "network",
            node: (
              <>
                <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
                  Network
                </span>
                {info.network.length > 0 ? (
                  <div className="space-y-1.5">
                    {info.network.map((iface) => (
                      <div key={iface.name} className="space-y-0.5">
                        <div className="text-xs font-mono text-fg-3 truncate">
                          {iface.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-emerald-400/90 tabular-nums">
                            {"↑"} {formatRate(iface.txBytes, POLL_INTERVAL)}
                          </span>
                          <span className="text-[10px] font-mono text-fg-3">
                            {"↓"} {formatRate(iface.rxBytes, POLL_INTERVAL)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs font-mono text-fg-4">No network connections found</div>
                )}
              </>
            ),
          });

          return cells.map((cell, i) => {
            const spanBoth = cells.length % 2 === 1 && i === cells.length - 1;
            return (
              <div
                key={cell.key}
                className={clsx(
                  FEED_CARD,
                  FEED_CARD_STATIC,
                  "space-y-1.5",
                  spanBoth && "col-span-2",
                )}
              >
                {cell.node}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// ── Manifest ────────────────────────────────────────────────────

export const sysmonWidget: WidgetManifest = {
  id: "sysmon",
  name: "System Monitor",
  tabLabel: "System",
  description: "Live CPU, memory, and GPU stats",
  hex: "#06b6d4",
  icon: Activity,
  info: {
    about:
      "The System Monitor widget shows live stats for your computer on the ticker, including CPU usage, memory, and GPU.",
    usage: [
      "CPU, memory, and GPU usage appear on the ticker.",
      "Turn individual stats on or off from the Stats menu in the top bar.",
      "The feed view shows detailed real-time stats including temperatures and a full breakdown.",
      "Pin it to a ticker row from Home to keep it in a fixed spot.",
    ],
  },
  desktopOnly: true,
  FeedTab: SysmonFeedTab,
};
