/**
 * ConsolidatedChip — generic ticker chip for clock, weather, sysmon, uptime, and github widgets.
 *
 * Replaces the three nearly-identical ClockConsolidatedChip,
 * WeatherConsolidatedChip, and SysmonConsolidatedChip components.
 */
import { clsx } from "clsx";
import { Pin, PinOff } from "lucide-react";
import Tooltip from "../Tooltip";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { MONITOR_STATUS_COLORS } from "../../widgets/uptime/types";
import { CI_STATUS_COLORS } from "../../widgets/github/types";
import type {
  ClockChipData,
  WeatherChipData,
  SysmonChipData,
  UptimeChipData,
  GitHubChipData,
} from "../../types";

// ── Item shape union ────────────────────────────────────────────

type ChipItem = ClockChipData | WeatherChipData | SysmonChipData | UptimeChipData | GitHubChipData;

// ── Type guards ─────────────────────────────────────────────────

function isWeather(item: ChipItem): item is WeatherChipData {
  return "temp" in item;
}

function isSysmon(item: ChipItem): item is SysmonChipData {
  return "hot" in item;
}

function isUptime(item: ChipItem): item is UptimeChipData {
  return "status" in item && "uptime" in item;
}

function isGithub(item: ChipItem): item is GitHubChipData {
  return "workflowName" in item;
}

// ── Heartbeat mini bar ──────────────────────────────────────────

const HB_COLORS: Record<number, string> = {
  1: "bg-up",         // up
  0: "bg-down",       // down
  3: "bg-info",       // maintenance
  2: "bg-warning",    // pending
};

function HeartbeatBar({ heartbeats }: { heartbeats: number[] }) {
  return (
    <span className="inline-flex items-center gap-px" aria-label="Recent heartbeat history">
      {heartbeats.map((status, i) => (
        <span
          key={i}
          className={clsx("w-[3px] h-2 rounded-[1px]", HB_COLORS[status] ?? "bg-fg-4/30")}
        />
      ))}
    </span>
  );
}

// ── Props ───────────────────────────────────────────────────────

interface ConsolidatedChipProps {
  type: "clock" | "weather" | "sysmon" | "uptime" | "github";
  items: ChipItem[];
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
}

// ── Component ───────────────────────────────────────────────────

export default function ConsolidatedChip({
  type,
  items,
  comfort,
  colorMode = "channel",
  pinned = false,
  onTogglePin,
  onClick,
}: ConsolidatedChipProps) {
  if (items.length === 0) return null;

  const c = getChipColors(colorMode, type);
  const PinIcon = pinned ? PinOff : Pin;
  const anyHot = type === "sysmon" && items.some((item) => isSysmon(item) && item.hot);
  const anyDown = type === "uptime" && items.some((item) => isUptime(item) && item.status === "down");
  const anyFailing = type === "github" && items.some((item) => isGithub(item) && item.status === "failure");

  return (
    <button
      onClick={onClick}
      className={clsx(
        chipBaseClasses(comfort, c, "relative font-mono whitespace-nowrap"),
        anyHot && "border-error/30",
        anyDown && "border-down/30",
        anyFailing && "border-down/30",
      )}
    >
      {/* Pin toggle (hover-only) */}
      {onTogglePin && (
        <Tooltip content={pinned ? "Unpin widget" : "Pin widget"}>
          <span
            role="button"
            tabIndex={0}
            aria-label={pinned ? "Unpin widget" : "Pin widget"}
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onTogglePin(); } }}
            className={clsx(
              "absolute -top-1 -right-1 z-10 p-0.5 rounded-full border transition-opacity",
              "bg-surface border-edge/50",
              pinned ? "opacity-80" : "opacity-0 group-hover:opacity-80 focus:opacity-80",
            )}
          >
            <PinIcon size={10} className={c.textDim} />
          </span>
        </Tooltip>
      )}

      {/* Row 1: all items inline */}
      <div className={clsx("flex items-center", comfort && "text-ui-body")}>
        {items.map((item, i) => (
          <div key={"id" in item ? item.id : i} className="flex items-center">
            {i > 0 && <span className={clsx("mx-2 text-ui-chip", c.textFaint)}>|</span>}
            <span className={clsx("font-semibold text-ui-chip uppercase tracking-wider mr-1.5", c.textDim)}>
              {"label" in item ? item.label : ""}
            </span>
            {isGithub(item) ? (
              <>
                <span className={clsx("w-1.5 h-1.5 rounded-full inline-block mr-1", CI_STATUS_COLORS[item.status] ?? "bg-fg-4")} />
                <span className={c.text}>{item.workflowName}</span>
              </>
            ) : isUptime(item) ? (
              <>
                <span className={clsx("w-1.5 h-1.5 rounded-full inline-block mr-1", MONITOR_STATUS_COLORS[item.status] ?? "bg-fg-4")} />
                <span className={c.text}>{item.uptime}</span>
              </>
            ) : isWeather(item) ? (
              <>
                <span className={c.text}>{item.temp}</span>
                <span className="text-[13px] leading-none ml-1">{item.icon}</span>
              </>
            ) : isSysmon(item) ? (
              <span className={clsx(item.hot ? "text-error" : c.text)}>
                {item.value}
              </span>
            ) : (
              <span className={c.text}>{"value" in item ? item.value : ""}</span>
            )}
          </div>
        ))}
      </div>

      {/* Row 2: detail (comfort only) */}
      {comfort && (
        <div className={clsx("flex items-center text-ui-chip", type === "weather" && "min-h-4", c.textFaint)}>
          {items.map((item, i) => {
            const hasDetail = item.detail || (isUptime(item) && item.heartbeats?.length);
            if (!hasDetail) return null;
            return (
              <div key={"id" in item ? item.id : i} className="flex items-center">
                {i > 0 && <span className="mx-2">|</span>}
                {isUptime(item) && item.heartbeats?.length ? (
                  <span className="flex items-center gap-1.5">
                    <HeartbeatBar heartbeats={item.heartbeats} />
                    {item.detail && <span>{item.detail}</span>}
                  </span>
                ) : (
                  <span>{item.detail}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}
