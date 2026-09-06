/**
 * Clock widget storage helpers — shared by WorldClock, ConfigPanel,
 * and the ticker data hook. The 12h/24h format is not here: it is
 * `appearance.units.timeFormat` in preferences.ts.
 */
import { getStore, setStore } from "../../lib/store";
import { LS_CLOCK_TIMEZONES } from "../../constants";

export const DEFAULT_TIMEZONES = ["America/New_York", "Europe/London", "Asia/Tokyo"];

export function loadTimezones(): string[] {
  const tzs = getStore<string[]>(LS_CLOCK_TIMEZONES, DEFAULT_TIMEZONES);
  return Array.isArray(tzs) && tzs.length > 0 ? tzs : DEFAULT_TIMEZONES;
}

export function saveTimezones(tzs: string[]): void {
  setStore(LS_CLOCK_TIMEZONES, tzs);
}

/** Extract a short display label from an IANA timezone identifier. */
export function tzLabel(tz: string): string {
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}
