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
import { getChipColors, chipBaseClasses } from "./chipColors";
import { ChipCap, cappedChipClasses } from "./ChipCap";
import type { CapTone } from "./ChipCap";
import { OnceFlash } from "./ChipFlash";
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


// ── Shared shell ────────────────────────────────────────────────

interface ShellProps {
  cap: { tone: CapTone; text: string; label: string; pulse?: boolean };
  type: "uptime" | "github";
  dim?: boolean;
  alert?: boolean;
  onClick?: () => void;
  /** Right-hand fixed cell: the one value that changes while on screen. */
  end?: React.ReactNode;
  children: React.ReactNode;
  /** A flash overlay (`OnceFlash`), drawn over the whole chip. */
  flash?: React.ReactNode;
}

function CapShell({
  cap,
  type,
  dim,
  alert,
  onClick,
  end,
  children,
  flash,
}: ShellProps) {
  const c = getChipColors(type);
  return (
    <button
      onClick={onClick}
      className={clsx(
        chipBaseClasses(c, "font-mono whitespace-nowrap"),
        cappedChipClasses("relative"),
        // Alert borders are semantic, never the widget accent — a red
        // edge has to mean the same thing on every chip on the rail.
        alert && "border-down/30",
        dim && "opacity-60",
      )}
    >
      <ChipCap
        tone={cap.tone}
        pulse={cap.pulse}
        label={cap.label}
      >
        {cap.text}
      </ChipCap>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-1.5">
        {children}
      </span>
      {/* The one number that changes, in its own bound cell on the right
          — the game chip's clock slot. Keeping it out of the flowing
          middle is what stops "99.98%" becoming "4m" and dragging the
          monitor's name sideways with it. */}
      {end != null && (
        <span
          className={clsx(
            "flex shrink-0 select-none items-center justify-center self-stretch border-l px-2",
            c.divider,
            "text-[13px] font-semibold tabular-nums",
          )}
        >
          {end}
        </span>
      )}
      {flash}
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

/**
 * Recent checks, as a row of bars.
 *
 * `bleed` stretches each bar to share the full width it is given rather
 * than sitting at a fixed 3px. On the detailed row the history owns the
 * whole cell, so the bar count stops being a width — twelve checks and
 * four checks draw the same size chip, which is what keeps the rail
 * from reflowing as a monitor's history fills up.
 */
function HeartbeatBar({
  heartbeats,
  bleed,
}: {
  heartbeats: number[];
  bleed?: boolean;
}) {
  return (
    <span
      className={clsx(
        "flex items-center",
        bleed ? "h-[7px] w-full gap-px" : "inline-flex gap-px",
      )}
      aria-label="Recent heartbeat history"
    >
      {heartbeats.map((status, i) => (
        <span
          key={i}
          className={clsx(
            bleed ? "h-full flex-1" : "h-2 w-[3px] rounded-[1px]",
            HB_COLORS[status] ?? "bg-fg-4/30",
          )}
        />
      ))}
    </span>
  );
}

export function UptimeCappedChip({
  item,
  onClick,
}: {
  item: UptimeChipData;
  onClick?: () => void;
}) {
  const cap = UPTIME_CAP[item.status] ?? UPTIME_CAP.pending;
  const down = item.status === "down";
  const c = getChipColors("uptime");

  // A down monitor's uptime percentage is the least useful number on
  // the chip. Swap in how long it's been down.
  const value = down ? (item.outageFor ?? "down") : item.uptime;

  return (
    <CapShell
      cap={cap}
      type="uptime"
      alert={down}
      onClick={onClick}
      end={
        <span className={down ? "text-down" : c.textDim}>{value}</span>
      }
    >
      {/* The monitor's name owns the flexible middle; the number sits in
          its own cell on the right, the way every other chip's clock
          does. */}
      <span className="flex min-w-0 items-center">
        <span className={clsx("min-w-0 truncate font-semibold", c.text)}>
          {item.label}
        </span>
      </span>
      {/* The whole detail row is the history, edge to edge. Uptime is
          the one widget whose past matters more than its present, and
          a percentage already sits on the row above. */}
      <span className="flex items-center pt-1">
        {item.heartbeats?.length ? (
          <HeartbeatBar heartbeats={item.heartbeats} bleed />
        ) : (
          <span className={clsx("truncate text-ui-chip", c.textFaint)}>
            {down ? item.detail : (item.responseAvg ?? item.detail)}
          </span>
        )}
      </span>
    </CapShell>
  );
}

// ── GitHub (SCROLLR-312) ────────────────────────────────────────

/** The repo's worst state on the cap: red, the accent's question, green, nothing to say. */
const GITHUB_CAP: Record<
  GitHubChipData["worst"],
  { tone: CapTone; text: string; label: string; pulse?: boolean }
> = {
  red: { tone: "down", text: "✗", label: "Failing", pulse: true },
  accent: { tone: "info", text: "●", label: "Needs a look" },
  ok: { tone: "up", text: "✓", label: "Green" },
  none: { tone: "neutral", text: "○", label: "Quiet" },
};

/**
 * One tracked repo on the rail: its worst state on the cap, the name and
 * its most urgent pill, the rest of its pills beneath, the age in the fixed
 * cell (the same pills as the page cell and the edge slot).
 */
export function GitHubCappedChip({
  item,
  onClick,
}: {
  item: GitHubChipData;
  onClick?: () => void;
}) {
  const c = getChipColors("github");
  const red = item.worst === "red";
  const [top, ...rest] = item.pills;
  return (
    <CapShell
      cap={GITHUB_CAP[item.worst]}
      type="github"
      alert={red}
      dim={item.worst === "none"}
      onClick={onClick}
      end={<span className={red ? "text-down" : c.textDim}>{item.age}</span>}
      flash={item.flash !== undefined ? <OnceFlash id={item.id} token={item.flash} tone={item.flashTone} /> : undefined}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={clsx("font-semibold", c.text)}>{item.label}</span>
        {top && <span className={red ? "font-semibold text-down" : c.textDim}>{top.text}</span>}
      </span>
      {rest.length > 0 && (
        <span className={clsx("truncate text-ui-chip", c.textFaint)}>{rest.map((p) => p.text).join(" · ")}</span>
      )}
    </CapShell>
  );
}

