/**
 * CappedChip — one uptime monitor or one GitHub workflow, opened by a
 * status cap.
 *
 * Uptime and GitHub read as one family on the rail by design: both
 * answer "is this thing OK", both lead with a cap, both put the
 * interesting detail where a lesser chip would repeat the status. They
 * share ChipCap rather than each growing a lookalike.
 *
 * One chip per item, not one chip per widget. The old ConsolidatedChip
 * packed every monitor into a single chip separated by pipes, which
 * made a single failure impossible to pick out of the row — the whole
 * point of a cap is that a red block is visible without reading.
 */
import { clsx } from "clsx";
import { Pin, PinOff } from "lucide-react";
import Tooltip from "../Tooltip";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { ChipCap, cappedChipClasses } from "./ChipCap";
import type { CapTone } from "./ChipCap";
import type { GitHubChipData, UptimeChipData } from "../../types";

// ── Status → cap ────────────────────────────────────────────────

const UPTIME_CAP: Record<
  UptimeChipData["status"],
  { tone: CapTone; text: string; label: string; pulse?: boolean }
> = {
  up: { tone: "up", text: "UP", label: "Up" },
  // The only state that earns attention, so the only one that pulses.
  down: { tone: "down", text: "DOWN", label: "Down", pulse: true },
  maintenance: { tone: "info", text: "MNT", label: "Maintenance" },
  pending: { tone: "warning", text: "···", label: "Pending" },
};

const GITHUB_CAP: Record<
  GitHubChipData["status"],
  { tone: CapTone; text: string; label: string; pulse?: boolean }
> = {
  success: { tone: "up", text: "✓", label: "Success" },
  failure: { tone: "down", text: "✗", label: "Failure" },
  in_progress: {
    tone: "warning",
    text: "●",
    label: "In progress",
    pulse: true,
  },
  // Queued isn't a problem, it's an absence — the whole chip dims.
  unavailable: { tone: "neutral", text: "○", label: "Queued" },
};

// ── Shared shell ────────────────────────────────────────────────

interface ShellProps {
  cap: { tone: CapTone; text: string; label: string; pulse?: boolean };
  type: "uptime" | "github";
  comfort?: boolean;
  colorMode?: ChipColorMode;
  dim?: boolean;
  alert?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
  children: React.ReactNode;
}

function CapShell({
  cap,
  type,
  comfort,
  colorMode = "widget",
  dim,
  alert,
  pinned,
  onTogglePin,
  onClick,
  children,
}: ShellProps) {
  const c = getChipColors(colorMode, type);
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <button
      onClick={onClick}
      className={clsx(
        chipBaseClasses(comfort, c, "font-mono whitespace-nowrap"),
        cappedChipClasses("relative"),
        // Alert borders are semantic, never the widget accent — a red
        // edge has to mean the same thing on every chip on the rail.
        alert && "border-down/30",
        dim && "opacity-60",
      )}
    >
      {onTogglePin && (
        <Tooltip content={pinned ? "Unpin widget" : "Pin widget"}>
          <span
            role="button"
            tabIndex={0}
            aria-label={pinned ? "Unpin widget" : "Pin widget"}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onTogglePin();
              }
            }}
            className={clsx(
              "absolute -right-1 -top-1 z-10 rounded-full border p-0.5 transition-opacity",
              "border-edge/50 bg-surface",
              pinned
                ? "opacity-80"
                : "opacity-0 focus:opacity-80 group-hover:opacity-80",
            )}
          >
            <PinIcon size={10} className={c.textDim} />
          </span>
        </Tooltip>
      )}
      <ChipCap
        tone={cap.tone}
        pulse={cap.pulse}
        comfort={comfort}
        label={cap.label}
      >
        {cap.text}
      </ChipCap>
      <span
        className={clsx(
          "flex min-w-0 flex-col justify-center px-3",
          comfort ? "gap-0.5 py-1.5" : "py-1",
        )}
      >
        {children}
      </span>
    </button>
  );
}

// ── Uptime ──────────────────────────────────────────────────────

const HB_COLORS: Record<number, string> = {
  1: "bg-up",
  0: "bg-down",
  3: "bg-info",
  2: "bg-warning",
};

function HeartbeatBar({ heartbeats }: { heartbeats: number[] }) {
  return (
    <span
      className="inline-flex items-center gap-px"
      aria-label="Recent heartbeat history"
    >
      {heartbeats.map((status, i) => (
        <span
          key={i}
          className={clsx(
            "h-2 w-[3px] rounded-[1px]",
            HB_COLORS[status] ?? "bg-fg-4/30",
          )}
        />
      ))}
    </span>
  );
}

export function UptimeCappedChip({
  item,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: {
  item: UptimeChipData;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
}) {
  const cap = UPTIME_CAP[item.status] ?? UPTIME_CAP.pending;
  const down = item.status === "down";
  const c = getChipColors(colorMode ?? "widget", "uptime");

  // A down monitor's uptime percentage is the least useful number on
  // the chip. Swap in how long it's been down.
  const value = down ? (item.outageFor ?? "down") : item.uptime;

  return (
    <CapShell
      cap={cap}
      type="uptime"
      comfort={comfort}
      colorMode={colorMode}
      alert={down}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={clsx("font-semibold", c.text)}>{item.label}</span>
        <span
          className={clsx(
            "tabular-nums",
            down ? "font-semibold text-down" : c.textDim,
          )}
        >
          {value}
        </span>
      </span>
      {comfort && (
        <span
          className={clsx(
            "flex items-center gap-1.5 text-ui-chip",
            c.textFaint,
          )}
        >
          {item.heartbeats?.length ? (
            <HeartbeatBar heartbeats={item.heartbeats} />
          ) : null}
          {/* Down chips lead with the incident, not the average. */}
          <span className="truncate">
            {down ? item.detail : (item.responseAvg ?? item.detail)}
          </span>
        </span>
      )}
    </CapShell>
  );
}

// ── GitHub ──────────────────────────────────────────────────────

export function GitHubCappedChip({
  item,
  comfort,
  colorMode,
  pinned,
  onTogglePin,
  onClick,
}: {
  item: GitHubChipData;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick?: () => void;
}) {
  const cap = GITHUB_CAP[item.status] ?? GITHUB_CAP.unavailable;
  const failed = item.status === "failure";
  const queued = item.status === "unavailable";
  const c = getChipColors(colorMode ?? "widget", "github");

  // A failure's most useful value is WHERE it broke — that's the thing
  // you'd otherwise open GitHub to find. Falls back to duration when
  // the jobs payload hasn't given us a step name.
  const value = failed
    ? item.failedStep
      ? `at ${item.failedStep}`
      : (item.elapsed ?? "failed")
    : (item.elapsed ?? "");

  return (
    <CapShell
      cap={cap}
      type="github"
      comfort={comfort}
      colorMode={colorMode}
      alert={failed}
      dim={queued}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onClick={onClick}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={clsx("font-semibold", c.text)}>
          {item.workflowName}
        </span>
        {item.branch && (
          <span className="text-widget-github/80">{item.branch}</span>
        )}
        {value && (
          <span
            className={clsx(
              "tabular-nums",
              failed ? "font-semibold text-down" : c.textDim,
            )}
          >
            {value}
          </span>
        )}
      </span>
      {comfort && item.detail && (
        <span className={clsx("truncate text-ui-chip", c.textFaint)}>
          {item.detail}
        </span>
      )}
    </CapShell>
  );
}
