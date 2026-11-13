import { describe, expect, it, vi } from "vitest";
import { formatterFor } from "./useWidgetTickerData";

describe("formatterFor", () => {
  it("builds one formatter per locale, zone and option set", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const opts = { hour: "numeric", timeZone: "Asia/Tokyo" } as const;
    const a = formatterFor("en-US", opts);
    for (let i = 0; i < 100; i++) formatterFor("en-US", { ...opts });
    expect(formatterFor("en-US", opts)).toBe(a);
    expect(formatterFor("en-US", { ...opts, timeZone: "Europe/Paris" })).not.toBe(a);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("formats like a fresh formatter and does not keep a bad zone", () => {
    const d = new Date("2026-11-13T12:00:00Z");
    const opts = { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" } as const;
    expect(formatterFor("en-US", opts).format(d)).toBe(new Intl.DateTimeFormat("en-US", opts).format(d));
    expect(() => formatterFor("en-US", { timeZone: "Not/AZone" })).toThrow(RangeError);
    expect(() => formatterFor("en-US", { timeZone: "Not/AZone" })).toThrow(RangeError);
  });
});
