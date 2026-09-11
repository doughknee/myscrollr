import { describe, expect, it, vi } from "vitest";
import {
  hydrateProductAnalyticsConsent,
  signalProductAnalyticsConsentMutation,
} from "./productAnalyticsConsent";

describe("product analytics consent hydration", () => {
  it("reports a failed setting load without applying an invented decision", async () => {
    const apply = vi.fn();
    const failed = vi.fn();
    const cleanup = hydrateProductAnalyticsConsent(() => Promise.reject(new Error("offline")), apply, failed);
    await Promise.resolve();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    cleanup();
  });
  it("ignores a GET that resolves after a consent mutation begins", async () => {
    let resolve!: (enabled: boolean) => void;
    const apply = vi.fn();
    const cleanup = hydrateProductAnalyticsConsent(
      () => new Promise((done) => { resolve = done; }),
      apply,
    );

    signalProductAnalyticsConsentMutation();
    resolve(true);
    await Promise.resolve();

    expect(apply).not.toHaveBeenCalled();
    cleanup();
  });
});
