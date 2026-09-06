/**
 * The crash-report switch (REL-209): while off, `beforeSend` must return
 * null so no event reaches the transport, on either window.
 */
import { describe, it, expect, vi } from "vitest";
import * as Sentry from "@sentry/react";
import type { ErrorEvent } from "@sentry/react";
import { initSentry, setCrashReports } from "./sentry";

vi.mock("@sentry/react", () => ({ init: vi.fn(), getClient: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

describe("crash-report gate", () => {
  it("beforeSend drops every event while the switch is off", () => {
    vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initSentry("app");

    const options = vi.mocked(Sentry.init).mock.calls[0][0]!;
    const event: ErrorEvent = { type: undefined, exception: { values: [] } };

    setCrashReports(false);
    expect(options.beforeSend!(event, {})).toBeNull();

    setCrashReports(true);
    expect(options.beforeSend!(event, {})).toBe(event);
  });
});
