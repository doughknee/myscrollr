import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateController } from "../lib/updateState";
import { useUpdateGate } from "./useUpdateGate";
import type { UpdateCandidate } from "../lib/updateState";

const shared = vi.hoisted(() => ({ controller: null as UpdateController | null }));
vi.mock("../lib/updateController", () => ({
  updateController: new Proxy({}, { get: (_, key) => shared.controller![key as keyof UpdateController] }),
}));
const fetchMinimum = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMinimum(...a) }));
let candidate: UpdateCandidate;
beforeEach(() => {
  fetchMinimum.mockReset();
  candidate = { version: "1.7.3", download: vi.fn(async () => {}), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  shared.controller = new UpdateController({
    load: async () => ({ version: "1.8.0-beta.1", channel: "stable", fresh: false }),
    saveChannel: async () => {}, restart: async () => {},
    check: async () => ({ feedVersion: "1.7.3", update: null, recoveryVersion: "1.7.3" }),
    prepareRecovery: async () => ({ feedVersion: "1.7.3", update: candidate, recoveryVersion: "1.7.3" }),
  });
});
afterEach(() => { cleanup(); });
function respond(minimum: unknown) {
  fetchMinimum.mockResolvedValue({ ok: true, json: async () => ({ min_desktop_version: minimum }) });
}

describe("server minimum and Stable recovery", () => {
  it("blocks an unsupported recovery target even when the installed Beta needs no overlay", async () => {
    respond(" 1.7.4 ");
    const { result, unmount } = renderHook(() => useUpdateGate("1.8.0-beta.1"));
    await waitFor(() => expect(result.current.minVersion).toBe("1.7.4"));
    expect(result.current.updateRequired).toBe(false);
    unmount(); // UI lifetime must not clear the controller's known policy.
    await shared.controller!.check();
    await shared.controller!.prepareRecovery();
    await shared.controller!.installRecovery(shared.controller!.getSnapshot().offerId);
    expect(shared.controller!.getSnapshot()).toMatchObject({ phase: "error", error: expect.stringContaining("required update") });
    expect(candidate.download).not.toHaveBeenCalled();
    expect(candidate.install).not.toHaveBeenCalled();
  });

  it("invalidates a prepared recovery when the minimum arrives late", async () => {
    await shared.controller!.check();
    await shared.controller!.prepareRecovery();
    const offer = shared.controller!.getSnapshot().offerId;
    respond("1.7.4");
    const { result } = renderHook(() => useUpdateGate("1.8.0-beta.1"));
    await waitFor(() => expect(result.current.minVersion).toBe("1.7.4"));
    await shared.controller!.installRecovery(offer);
    expect(candidate.install).not.toHaveBeenCalled();
    expect(candidate.close).toHaveBeenCalledTimes(1);
    expect(shared.controller!.getSnapshot().phase).toBe("error");
  });

  it.each(["offline", "http", "malformed", "empty"])("fails open on initial %s response", async failure => {
    if (failure === "offline") fetchMinimum.mockRejectedValue(new Error("offline"));
    else if (failure === "http") fetchMinimum.mockResolvedValue({ ok: false });
    else respond(failure === "empty" ? "" : "not-a-version");
    let gate!: ReturnType<typeof renderHook<ReturnType<typeof useUpdateGate>, unknown>>;
    await act(async () => { gate = renderHook(() => useUpdateGate("1.8.0-beta.1")); });
    expect(gate.result.current.updateRequired).toBe(false);
    await shared.controller!.check();
    await shared.controller!.prepareRecovery();
    await shared.controller!.installRecovery(shared.controller!.getSnapshot().offerId);
    expect(candidate.install).toHaveBeenCalledTimes(1);
  });

  it("does not erase a known minimum after a malformed response on remount", async () => {
    respond("1.7.4");
    const first = renderHook(() => useUpdateGate("1.8.0-beta.1"));
    await waitFor(() => expect(first.result.current.minVersion).toBe("1.7.4"));
    first.unmount();
    respond("not-a-version");
    await act(async () => { renderHook(() => useUpdateGate("1.8.0-beta.1")); });
    await shared.controller!.check();
    expect(shared.controller!.getSnapshot().phase).toBe("error");
  });

  it("reads the minimum again every few hours, so an app left open learns the floor moved (RC-10)", async () => {
    vi.useFakeTimers();
    try {
      respond("1.7.4");
      const { result } = renderHook(() => useUpdateGate("1.7.5"));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.updateRequired).toBe(false);
      respond("1.8.0");
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000); });
      expect(fetchMinimum).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
      expect(fetchMinimum).toHaveBeenCalledTimes(2);
      expect(result.current.updateRequired).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
