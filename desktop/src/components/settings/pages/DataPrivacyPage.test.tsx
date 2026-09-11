import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataPrivacyPage from "./DataPrivacyPage";
import type { PrivacyPrefs } from "../../../preferences";

const setConsent = vi.fn();
const setPostHogConsent = vi.fn();
vi.mock("../../../api/client", () => ({
  exportUserData: vi.fn(),
  setProductAnalyticsConsent: (...args: unknown[]) => setConsent(...args),
  setPostHogAnalyticsConsent: (...args: unknown[]) => setPostHogConsent(...args),
}));

describe("DataPrivacyPage product activity consent", () => {
  beforeEach(() => {
    setConsent.mockReset();
    setPostHogConsent.mockReset();
  });

  it("shows the opt-in only while signed in and waits for server confirmation", async () => {
    let resolve!: (value: { enabled: boolean }) => void;
    setConsent.mockReturnValue(new Promise((done) => { resolve = done; }));
    const onPrivacyChange = vi.fn();
    const { rerender } = render(
      <DataPrivacyPage
        authenticated={false}
        privacy={{ sendCrashReports: true, shareProductAnalytics: false, postHogAnalyticsDecision: "unknown" }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    expect(screen.queryByRole("switch", { name: /share product activity/i })).toBeNull();

    rerender(
      <DataPrivacyPage
        authenticated
        privacy={{ sendCrashReports: true, shareProductAnalytics: false, postHogAnalyticsDecision: "unknown" }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    const mutationStarted = vi.fn();
    window.addEventListener("scrollr:product-analytics-consent-mutation", mutationStarted, { once: true });
    fireEvent.click(screen.getByRole("switch", { name: /share product activity/i }));
    expect(mutationStarted).toHaveBeenCalledTimes(1);
    expect(setConsent).toHaveBeenCalledWith(true);
    expect(onPrivacyChange).not.toHaveBeenCalled();
    await act(async () => resolve({ enabled: true }));
    expect(onPrivacyChange).toHaveBeenCalledWith({
      sendCrashReports: true,
      shareProductAnalytics: true,
      postHogAnalyticsDecision: "unknown",
    });
  });

  it("keeps crash-report consent independent", () => {
    const onPrivacyChange = vi.fn();
    render(
      <DataPrivacyPage
        authenticated
        privacy={{ sendCrashReports: true, shareProductAnalytics: false, postHogAnalyticsDecision: "unknown" }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /send crash reports/i }));
    expect(onPrivacyChange).toHaveBeenCalledWith({
      sendCrashReports: false,
      shareProductAnalytics: false,
      postHogAnalyticsDecision: "unknown",
    });
    expect(setConsent).not.toHaveBeenCalled();
  });

  it("keeps PostHog consent separate and server-authoritative", async () => {
    setPostHogConsent.mockResolvedValue({ decision: "enabled" });
    const onPrivacyChange = vi.fn();
    render(
      <DataPrivacyPage
        authenticated
        privacy={{ sendCrashReports: true, shareProductAnalytics: false, postHogAnalyticsDecision: "unknown" }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /share app analytics/i }));
    expect(setPostHogConsent).toHaveBeenCalledWith("enabled");
    await act(async () => undefined);
    expect(onPrivacyChange).toHaveBeenCalledWith({
      sendCrashReports: true,
      shareProductAnalytics: false,
      postHogAnalyticsDecision: "enabled",
    });
  });

  it("preserves a newer crash-report change when PostHog consent finishes", async () => {
    let resolve!: (value: { decision: "declined" }) => void;
    setPostHogConsent.mockReturnValue(new Promise((done) => { resolve = done; }));

    function Harness() {
      const [privacy, setPrivacy] = useState<PrivacyPrefs>({
        sendCrashReports: true,
        shareProductAnalytics: false,
        postHogAnalyticsDecision: "enabled",
      });
      return (
        <DataPrivacyPage
          authenticated
          privacy={privacy}
          onPrivacyChange={setPrivacy}
          onResetAll={vi.fn()}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: /share app analytics/i }));
    fireEvent.click(screen.getByRole("switch", { name: /send crash reports/i }));
    await act(async () => resolve({ decision: "declined" }));

    expect(screen.getByRole("switch", { name: /share app analytics/i })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /send crash reports/i })).not.toBeChecked();
  });
});
