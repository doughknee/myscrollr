import { describe, expect, it, vi } from "vitest";
import {
  hydrateProductAnalyticsConsent,
  signalProductAnalyticsConsentMutation,
} from "./productAnalyticsConsent";

describe("product analytics consent hydration", () => {
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
