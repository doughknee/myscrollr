import { Activity } from "lucide-react";
import type { FeedTabProps, WidgetManifest } from "../../types";
import { useSysmonData } from "../../hooks/useSysmonData";
import { formatBytes, formatUptime } from "../../utils/format";
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

function SysmonFeedTab({ mode: feedMode }: FeedTabProps) {
  const compact = feedMode === "compact";
  const info = useSysmonData(POLL_INTERVAL);

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

        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-widget-sysmon/[0.04] border border-widget-sysmon/10">
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
          <div className="w-px h-4 bg-widget-sysmon/10" />
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
          {(info.gpuUsage !== null || gpuTemp) && (
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
                    {Math.round(gpuTemp.temp)}&deg;
                  </span>
                ) : null}
              </div>
            </>
          )}
          {info.gpuPowerWatts !== null && (
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

      {/* 2x2 stats grid */}
      <div className="grid grid-cols-2 rounded-xl border border-widget-sysmon/10 overflow-hidden">
        {/* CPU */}
        <div className="p-3 border-r border-b border-widget-sysmon/10 bg-widget-sysmon/[0.03] space-y-1.5">
          <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
            CPU
          </span>
          <div className="text-[10px] font-mono text-fg-3 uppercase tracking-wider -mt-1">
            Usage
          </div>
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
              cpuTemp
                ? `${Math.round(cpuTemp.temp)}\u00B0C`
                : null,
            ]}
          />
        </div>

        {/* Memory */}
        <div className="p-3 border-b border-widget-sysmon/10 bg-widget-sysmon/[0.03] space-y-1.5">
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
        </div>

        {/* GPU */}
        <div className="p-3 border-r border-widget-sysmon/10 bg-widget-sysmon/[0.03] space-y-1.5">
          <span className="text-xs font-mono text-widget-sysmon/70 uppercase tracking-wider">
            GPU
          </span>
          {info.gpuUsage !== null ? (
            <>
              <div className="text-[10px] font-mono text-fg-3 uppercase tracking-wider -mt-1">
                Usage
              </div>
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
                  info.gpuPowerWatts !== null
                    ? formatWatts(info.gpuPowerWatts)
                    : null,
                  gpuTemp
                    ? `${Math.round(gpuTemp.temp)}\u00B0C`
                    : null,
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
              {Math.round(gpuTemp.temp)}&deg;C
            </div>
          ) : (
            <div className="text-xs font-mono text-fg-4">No GPU detected</div>
          )}
        </div>

        {/* Network */}
        <div className="p-3 bg-widget-sysmon/[0.03] space-y-1.5">
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
                      {"\u2191"} {formatRate(iface.txBytes, POLL_INTERVAL)}
                    </span>
                    <span className="text-[10px] font-mono text-fg-3">
                      {"\u2193"} {formatRate(iface.rxBytes, POLL_INTERVAL)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs font-mono text-fg-4">No network connections found</div>
          )}
        </div>
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
      "Turn individual stats on or off in the Configure tab.",
      "The feed view shows detailed real-time stats including temperatures and a full breakdown.",
      "Keep the system monitor in a fixed spot on the ticker from the Configure tab.",
    ],
  },
  desktopOnly: true,
  FeedTab: SysmonFeedTab,
};
