/**
 * WorldClock section — displays local + user-selected time zones.
 *
 * Timezone selections and format (12h/24h) are persisted to Tauri store.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import Tooltip from "../../components/Tooltip";
import { FEED_CARD, FEED_CARD_STATIC } from "../../components/feedCard";
import { loadTimezones, saveTimezones, tzLabel } from "./storage";
import type { TimeFormat, TimezoneEntry } from "./types";

// ── Timezone presets ────────────────────────────────────────────

const TIMEZONE_PRESETS: TimezoneEntry[] = [
  // Americas
  { tz: "America/New_York", label: "New York", region: "US" },
  { tz: "America/Chicago", label: "Chicago", region: "US" },
  { tz: "America/Denver", label: "Denver", region: "US" },
  { tz: "America/Los_Angeles", label: "Los Angeles", region: "US" },
  { tz: "America/Anchorage", label: "Anchorage", region: "US" },
  { tz: "Pacific/Honolulu", label: "Honolulu", region: "US" },
  { tz: "America/Toronto", label: "Toronto", region: "Canada" },
  { tz: "America/Vancouver", label: "Vancouver", region: "Canada" },
  { tz: "America/Mexico_City", label: "Mexico City", region: "Mexico" },
  { tz: "America/Sao_Paulo", label: "Sao Paulo", region: "Brazil" },
  {
    tz: "America/Argentina/Buenos_Aires",
    label: "Buenos Aires",
    region: "Argentina",
  },
  { tz: "America/Bogota", label: "Bogota", region: "Colombia" },
  { tz: "America/Lima", label: "Lima", region: "Peru" },
  // Europe
  { tz: "Europe/London", label: "London", region: "UK" },
  { tz: "Europe/Paris", label: "Paris", region: "France" },
  { tz: "Europe/Berlin", label: "Berlin", region: "Germany" },
  { tz: "Europe/Madrid", label: "Madrid", region: "Spain" },
  { tz: "Europe/Rome", label: "Rome", region: "Italy" },
  { tz: "Europe/Amsterdam", label: "Amsterdam", region: "Netherlands" },
  { tz: "Europe/Zurich", label: "Zurich", region: "Switzerland" },
  { tz: "Europe/Stockholm", label: "Stockholm", region: "Sweden" },
  { tz: "Europe/Warsaw", label: "Warsaw", region: "Poland" },
  { tz: "Europe/Athens", label: "Athens", region: "Greece" },
  { tz: "Europe/Moscow", label: "Moscow", region: "Russia" },
  { tz: "Europe/Istanbul", label: "Istanbul", region: "Turkey" },
  // Middle East / Africa
  { tz: "Asia/Dubai", label: "Dubai", region: "UAE" },
  { tz: "Asia/Riyadh", label: "Riyadh", region: "Saudi Arabia" },
  { tz: "Africa/Cairo", label: "Cairo", region: "Egypt" },
  { tz: "Africa/Lagos", label: "Lagos", region: "Nigeria" },
  {
    tz: "Africa/Johannesburg",
    label: "Johannesburg",
    region: "South Africa",
  },
  // Asia
  { tz: "Asia/Kolkata", label: "Mumbai", region: "India" },
  { tz: "Asia/Bangkok", label: "Bangkok", region: "Thailand" },
  { tz: "Asia/Singapore", label: "Singapore", region: "Singapore" },
  { tz: "Asia/Hong_Kong", label: "Hong Kong", region: "China" },
  { tz: "Asia/Shanghai", label: "Shanghai", region: "China" },
  { tz: "Asia/Tokyo", label: "Tokyo", region: "Japan" },
  { tz: "Asia/Seoul", label: "Seoul", region: "South Korea" },
  { tz: "Asia/Jakarta", label: "Jakarta", region: "Indonesia" },
  // Oceania
  { tz: "Australia/Sydney", label: "Sydney", region: "Australia" },
  { tz: "Australia/Melbourne", label: "Melbourne", region: "Australia" },
  { tz: "Australia/Perth", label: "Perth", region: "Australia" },
  { tz: "Pacific/Auckland", label: "Auckland", region: "New Zealand" },
];

// ── Formatting helpers ──────────────────────────────────────────

function fmtTime(tz: string, fmt: TimeFormat): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: fmt === "12h",
    timeZone: tz,
  }).format(new Date());
}

function fmtDate(tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date());
}

function getUtcOffset(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

// ── Clock Card ──────────────────────────────────────────────────

function ClockCard({
  tz,
  label,
  isLocal,
  compact,
  fmt,
  onRemove,
}: {
  tz: string;
  label: string;
  isLocal: boolean;
  compact: boolean;
  fmt: TimeFormat;
  onRemove?: () => void;
}) {
  const [time, setTime] = useState(fmtTime(tz, fmt));
  const [date, setDate] = useState(fmtDate(tz));

  useEffect(() => {
    const tick = () => {
      setTime(fmtTime(tz, fmt));
      setDate(fmtDate(tz));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tz, fmt]);

  const offset = getUtcOffset(tz);

  if (compact) {
    return (
      <div
        className={clsx(FEED_CARD, FEED_CARD_STATIC, "flex items-center justify-between gap-2 py-2")}
      >
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <span className="text-xs font-mono text-widget-clock/80 uppercase tracking-wider shrink-0 w-20 truncate">
            {label}
          </span>
          <span className="shrink-0 text-sm font-mono font-semibold text-fg tabular-nums">
            {time}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="max-w-16 truncate text-[11px] font-mono text-fg-2">
            {offset}
          </span>
          {!isLocal && onRemove && (
            <Tooltip content="Remove timezone">
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${label} timezone`}
                className="flex size-7 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <X size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(FEED_CARD, FEED_CARD_STATIC, "overflow-hidden")}>
      <div className="flex items-center gap-2 mb-1">
        <span className="min-w-0 truncate text-xs font-mono text-widget-clock/80 uppercase tracking-wider">
          {label}
        </span>
        {isLocal && (
          <span className="text-[10px] font-mono text-widget-clock/70 uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-widget-clock/10 border border-widget-clock/15">
            local
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] font-mono text-fg-2">
          {offset}
        </span>
        {!isLocal && onRemove && (
          <Tooltip content="Remove timezone">
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${label} timezone`}
              className="flex size-7 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <X size={13} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className={isLocal ? "text-2xl font-mono font-bold text-fg tabular-nums leading-none" : "text-xl font-mono font-bold text-fg tabular-nums leading-none"}>
        {time}
      </div>
      <div className="text-xs font-mono text-fg-2 mt-1">{date}</div>
    </div>
  );
}

// ── WorldClock Section ──────────────────────────────────────────

interface WorldClockProps {
  compact: boolean;
  fmt: TimeFormat;
  /** Comfort mode: the WidgetBar's SearchBox drives the add-timezone
   *  picker through these; the in-body "+ Add" toggle only renders when
   *  they're absent (compact, which has no bar). */
  addQuery?: string;
  onAddQueryChange?: (q: string) => void;
}

export function WorldClock({
  compact,
  fmt,
  addQuery,
  onAddQueryChange,
}: WorldClockProps) {
  const [timezones, setTimezones] = useState(loadTimezones);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const barDriven = addQuery !== undefined;
  const effectiveSearch = barDriven ? addQuery : search;
  const searchRef = useRef<HTMLInputElement>(null);
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (showAdd && searchRef.current) searchRef.current.focus();
    if (!showAdd) setSearch("");
  }, [showAdd]);

  const handleRemove = useCallback((tz: string) => {
    setTimezones((p) => {
      const n = p.filter((t) => t !== tz);
      saveTimezones(n);
      return n;
    });
  }, []);

  const handleAdd = useCallback((tz: string) => {
    setTimezones((p) => {
      if (p.includes(tz)) return p;
      const n = [...p, tz];
      saveTimezones(n);
      return n;
    });
    setSearch("");
    onAddQueryChange?.("");
  }, [onAddQueryChange]);

  const allZones = [localTz, ...timezones.filter((tz) => tz !== localTz)];

  const available = useMemo(() => {
    const added = new Set(allZones);
    const filtered = TIMEZONE_PRESETS.filter((p) => !added.has(p.tz));
    if (!effectiveSearch.trim()) return filtered;
    const q = effectiveSearch.toLowerCase();
    return filtered.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q) ||
        p.tz.toLowerCase().includes(q),
    );
  }, [allZones, effectiveSearch]);

  return (
    <>
      {/* Controls — the bar's SearchBox replaces this in comfort mode. */}
      {!barDriven && (
        <div className="flex items-center justify-end px-1 mb-1">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className={
              "text-xs font-mono  " +
              (showAdd
                ? "text-widget-clock"
                : "text-widget-clock/70 hover:text-widget-clock")
            }
          >
            {showAdd ? "Done" : "+ Add"}
          </button>
        </div>
      )}

      {/* Add timezone picker */}
      {(barDriven ? addQuery.trim().length > 0 : showAdd) && (
        <div
          className="rounded-lg border border-widget-clock/15 bg-surface-2 overflow-hidden"
        >
          {!barDriven && (
            <div className="px-3 py-2 border-b border-edge/50">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cities..."
                className="w-full bg-transparent text-xs font-mono text-fg placeholder:text-fg-3 outline-none"
              />
            </div>
          )}
          <div className="max-h-44 overflow-y-auto scrollbar-thin">
            {available.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs font-mono text-fg-3">
                {effectiveSearch ? "No matching cities" : "All timezones added"}
              </div>
            ) : (
              available.map((preset) => (
                <button
                  key={preset.tz}
                  onClick={() => handleAdd(preset.tz)}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-left hover:bg-widget-clock/[0.06] "
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-fg">
                      {preset.label}
                    </span>
                    <span className="text-[11px] font-mono text-fg-2 truncate">
                      {preset.region}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-fg-2 shrink-0 ml-2">
                    {getUtcOffset(preset.tz)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Clock cards */}
      <div className={compact ? "space-y-1" : "grid gap-2"}>
        {allZones.map((tz) => {
          const isLocal = tz === localTz;
          const preset = TIMEZONE_PRESETS.find((p) => p.tz === tz);
          const label = isLocal ? tzLabel(localTz) : (preset?.label ?? tzLabel(tz));
          return (
            <ClockCard
              key={tz}
              tz={tz}
              label={label}
              isLocal={isLocal}
              compact={compact}
              fmt={fmt}
              onRemove={isLocal ? undefined : () => handleRemove(tz)}
            />
          );
        })}
      </div>
    </>
  );
}
