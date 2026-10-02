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
import { needsYou } from "../../widgets/github/types";
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

// Connected GitHub (SCROLLR-308): the same four states as the edge slot.
// Needs you leads with the count; nothing ever says "passing".
const GITHUB_STATE_CAP: Record<
  NonNullable<GitHubChipData["state"]>,
  { tone: CapTone; text: string; label: string; pulse?: boolean }
> = {
  needs: { tone: "info", text: "", label: "Needs you" },
  broken: { tone: "down", text: "✗", label: "Default branch failing" },
  running: { tone: "warning", text: "●", label: "Running on yours", pulse: true },
  passing: { tone: "up", text: "✓", label: "Default branch green" },
  quiet: { tone: "neutral", text: "○", label: "Quiet" },
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

// ── GitHub ──────────────────────────────────────────────────────

export function GitHubCappedChip({
  item,
  onClick,
}: {
  item: GitHubChipData;
  onClick?: () => void;
}) {
  const c = getChipColors("github");
  if (item.state) return <GitHubStateChip item={item} onClick={onClick} />;
  const cap = GITHUB_CAP[item.status] ?? GITHUB_CAP.unavailable;
  const failed = item.status === "failure";
  const queued = item.status === "unavailable";

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
      alert={failed}
      dim={queued}
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
      {item.detail && (
        <span className={clsx("truncate text-ui-chip", c.textFaint)}>
          {item.detail}
        </span>
      )}
    </CapShell>
  );
}

/** A connected repo: the state on the cap, its age in the fixed cell. */
function GitHubStateChip({
  item,
  onClick,
}: {
  item: GitHubChipData;
  onClick?: () => void;
}) {
  const state = item.state!;
  const c = getChipColors("github");
  const base = GITHUB_STATE_CAP[state];
  const cap =
    state === "needs"
      ? { ...base, text: (item.needs ?? 0) > 99 ? "99+" : String(item.needs ?? 0) }
      : base;
  const broken = state === "broken";
  const ci = item.defaultCi;
  const top =
    state === "needs"
      ? "for you"
      : state === "running"
        ? "yours"
        : (ci?.workflow ?? item.workflowName);
  const detail =
    state === "needs"
      ? (item.page ?? needsYou(item.prs))[0]?.title
      : state === "running"
        ? item.mineBranch
        : ci?.commit_message?.split("\n")[0];
  return (
    <CapShell
      cap={cap}
      type="github"
      alert={broken}
      onClick={onClick}
      end={
        state === "needs" ? undefined : (
          <span className={broken ? "text-down" : c.textDim}>{item.age}</span>
        )
      }
      flash={
        item.flash !== undefined ? (
          <OnceFlash id={item.id} token={item.flash} tone={item.flashTone} />
        ) : undefined
      }
    >
      <span className="flex items-baseline gap-1.5">
        <span className={clsx("font-semibold", c.text)}>{item.label}</span>
        <span className={broken ? "font-semibold text-down" : c.textDim}>
          {top}
        </span>
      </span>
      {detail && (
        <span className={clsx("truncate text-ui-chip", c.textFaint)}>
          {detail}
        </span>
      )}
    </CapShell>
  );
}
