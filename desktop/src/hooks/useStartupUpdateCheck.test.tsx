import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateController } from "../lib/updateState";
import { useStartupUpdateCheck } from "./useStartupUpdateCheck";

const shared = vi.hoisted(() => ({ controller: null as UpdateController | null,
  toast: { info: vi.fn(), loading: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));
vi.mock("sonner", () => ({ toast: shared.toast }));
vi.mock("../lib/updateController", async () => {
  const { useSyncExternalStore } = await import("react");
  return { updateController: new Proxy({}, { get: (_, key) => shared.controller![key as keyof UpdateController] }),
    useUpdateController: () => useSyncExternalStore(shared.controller!.subscribe, shared.controller!.getSnapshot) };
});
function Host() { useStartupUpdateCheck({ appVersion: "1.7.2" }); return null; }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("checks once after StrictMode replay, retains install errors and failed explicit retries", async () => {
  const candidate = { version: "1.8.0", download: vi.fn(async () => { throw new Error("Signature invalid"); }), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const check = vi.fn(async () => ({ feedVersion: "1.8.0", update: candidate }));
  shared.controller = new UpdateController({ load: async () => ({ version: "1.7.2", channel: "stable", fresh: false }), saveChannel: async () => {}, check, restart: async () => {} });
  await shared.controller.initialize();
  render(<StrictMode><Host /></StrictMode>);
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(check).toHaveBeenCalledTimes(1);
  await act(async () => shared.toast.info.mock.calls.at(-1)![1].action.onClick());
  expect(shared.toast.error).toHaveBeenCalledWith("Could not install update", expect.objectContaining({ description: expect.stringContaining("Signature invalid") }));
  check.mockRejectedValueOnce(new Error("Offline on retry"));
  await act(async () => shared.toast.error.mock.calls.at(-1)![1].action.onClick());
  expect(shared.toast.error.mock.calls.at(-1)![1].description).toContain("Offline on retry");
});

it("keeps an automatic startup feed failure quiet", async () => {
  shared.controller = new UpdateController({ load: async () => ({ version: "1.7.2", channel: "stable", fresh: false }), saveChannel: async () => {}, check: async () => { throw new Error("Offline"); }, restart: async () => {} });
  await shared.controller.initialize(); render(<StrictMode><Host /></StrictMode>);
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(shared.toast.error).not.toHaveBeenCalled();
  expect(shared.controller.getSnapshot().phase).toBe("error");
});
