import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataPrivacyPage from "./DataPrivacyPage";

const setConsent = vi.fn();
vi.mock("../../../api/client", () => ({
  exportUserData: vi.fn(),
  setProductAnalyticsConsent: (...args: unknown[]) => setConsent(...args),
}));

describe("DataPrivacyPage product activity consent", () => {
  beforeEach(() => setConsent.mockReset());

  it("shows the opt-in only while signed in and waits for server confirmation", async () => {
    let resolve!: (value: { enabled: boolean }) => void;
    setConsent.mockReturnValue(new Promise((done) => { resolve = done; }));
    const onPrivacyChange = vi.fn();
    const { rerender } = render(
      <DataPrivacyPage
        authenticated={false}
        privacy={{ sendCrashReports: true, shareProductAnalytics: false }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    expect(screen.queryByRole("switch", { name: /share product activity/i })).toBeNull();

    rerender(
      <DataPrivacyPage
        authenticated
        privacy={{ sendCrashReports: true, shareProductAnalytics: false }}
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
    });
  });

  it("keeps crash-report consent independent", () => {
    const onPrivacyChange = vi.fn();
    render(
      <DataPrivacyPage
        authenticated
        privacy={{ sendCrashReports: true, shareProductAnalytics: false }}
        onPrivacyChange={onPrivacyChange}
        onResetAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /send crash reports/i }));
    expect(onPrivacyChange).toHaveBeenCalledWith({
      sendCrashReports: false,
      shareProductAnalytics: false,
    });
    expect(setConsent).not.toHaveBeenCalled();
  });
});
