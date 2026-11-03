import { describe, expect, it, vi } from "vitest";
import { DOWNLOAD_TIMEOUT_MS, UpdateController } from "./updateState";
import type { UpdateCandidate, UpdateDependencies } from "./updateState";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(initial = { version: "1.7.2", channel: undefined as unknown, fresh: false }) {
  const candidate: UpdateCandidate = { version: "1.8.0", body: "Release notes", download: vi.fn(async () => {}), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const deps: UpdateDependencies = { load: vi.fn(async () => initial), saveChannel: vi.fn(async () => {}), check: vi.fn(async () => ({ feedVersion: candidate.version, update: candidate })), restart: vi.fn(async () => {}) };
  return { controller: new UpdateController(deps), candidate, deps };
}
describe("shared update controller", () => {
  it.each([
    ["1.7.2", undefined, true, "stable"], ["1.8.0-beta.1", undefined, true, "beta"],
    ["1.8.0-beta.1", undefined, false, "stable"], ["1.8.0-beta.1", "stable", true, "stable"],
    ["1.8.0", "beta", false, "beta"], ["1.8.0-beta.1", "nonsense", false, "stable"],
  ])("initializes %s / %s / fresh=%s as %s", async (version, channel, fresh, expected) => {
    const { controller, deps } = setup({ version: version as string, channel, fresh: fresh as boolean });
    await controller.initialize(); await controller.initialize();
    expect(controller.getSnapshot().channel).toBe(expected);
    expect(deps.load).toHaveBeenCalledTimes(1);
    expect(deps.check).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent checks and preserves state between subscribers", async () => {
    const { controller, deps, candidate } = setup();
    const pending = deferred<{ feedVersion: string; update: UpdateCandidate }>();
    vi.mocked(deps.check).mockReturnValue(pending.promise);
    const a = controller.check(), b = controller.check();
    await vi.waitFor(() => expect(deps.check).toHaveBeenCalledTimes(1));
    pending.resolve({ feedVersion: candidate.version, update: candidate });
    await Promise.all([a, b]);
    const off = controller.subscribe(vi.fn()); off();
    expect(controller.getSnapshot().phase).toBe("available");
  });
  it("invalidates stale offers on channel change without installing or checking", async () => {
    const { controller, candidate, deps } = setup();
    await controller.check(); const stale = controller.getSnapshot().offerId;
    await controller.selectChannel("beta");
    expect(candidate.close).toHaveBeenCalledTimes(1);
    await controller.check(); await controller.install(stale);
    expect(candidate.download).not.toHaveBeenCalled();
    expect(deps.saveChannel).toHaveBeenLastCalledWith("beta");
  });
  it("serializes download/install against startup, settings, channel changes and mandatory updates", async () => {
    const { controller, deps, candidate } = setup();
    await controller.check();
    const pending = deferred();
    vi.mocked(candidate.download).mockImplementation(async (progress, options) => {
      expect(options.timeout).toBe(DOWNLOAD_TIMEOUT_MS);
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 40 } });
      await pending.promise;
    });
    const install = controller.install();
    await vi.waitFor(() => expect(controller.getSnapshot().downloaded).toBe(40));
    const check = controller.check(); await controller.selectChannel("beta"); await controller.install();
    expect(controller.getSnapshot().channel).toBe("stable");
    expect(deps.check).toHaveBeenCalledTimes(1);
    pending.resolve(); await Promise.all([install, check]);
    expect(candidate.install).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe("ready");
    await controller.check(); await controller.selectChannel("beta"); await controller.install();
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(candidate.download).toHaveBeenCalledTimes(1);
  });
  it.each(["timeout", "offline", "429", "500", "malformed feed", "missing platform"])("releases failed %s checks for retry without claiming current", async error => {
    const { controller, deps } = setup();
    vi.mocked(deps.check).mockRejectedValueOnce(new Error(error));
    await controller.check(); expect(controller.getSnapshot().phase).toBe("error");
    await controller.check(); expect(controller.getSnapshot().phase).toBe("available");
  });
  it.each(["stalled body timeout", "bad signature", "interrupted download"])("does not install after %s, closes resources and permits retry", async error => {
    const { controller, candidate } = setup();
    await controller.check(); vi.mocked(candidate.download).mockRejectedValueOnce(new Error(error));
    await controller.install();
    expect(candidate.install).not.toHaveBeenCalled(); expect(candidate.close).toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("error");
    await controller.check(); await controller.install();
    expect(controller.getSnapshot().phase).toBe("ready");
  });
  it("restart failure preserves ready state and retries restart without redownloading", async () => {
    const { controller, deps, candidate } = setup();
    await controller.check(); await controller.install();
    vi.mocked(deps.restart).mockRejectedValueOnce(new Error("OS denied restart"));
    await controller.restart();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", error: expect.stringContaining("already installed") });
    await controller.restart(); expect(deps.restart).toHaveBeenCalledTimes(2);
    expect(candidate.download).toHaveBeenCalledTimes(1);
  });
  it("leaving Beta waits for newer Stable and never downgrades", async () => {
    const { controller, deps } = setup({ version: "1.8.0-beta.1", channel: "beta", fresh: false });
    await controller.initialize(); await controller.selectChannel("stable");
    vi.mocked(deps.check).mockResolvedValue({ feedVersion: "1.7.2", update: null });
    await controller.check(); expect(controller.getSnapshot().phase).toBe("waiting");
  });
  it.each(["1.7.2", "1.7.1", "1.8.0-beta.1", "garbage"])("refuses invalid Stable candidate %s", async version => {
    const { controller, candidate } = setup(); candidate.version = version;
    await controller.check(); await controller.install();
    expect(controller.getSnapshot().phase).toBe("error"); expect(candidate.download).not.toHaveBeenCalled();
  });
  it("blocks an offer below a newly required minimum at install time", async () => {
    const { controller, candidate } = setup(); await controller.check();
    controller.setMinimum("1.9.0"); await controller.install();
    expect(candidate.download).not.toHaveBeenCalled();
    await controller.check(); expect(controller.getSnapshot().error).toContain("required update is not available");
  });
  it("keeps the selected channel on disk failure and permits retry", async () => {
    const { controller, deps } = setup(); await controller.initialize();
    vi.mocked(deps.saveChannel).mockRejectedValueOnce(new Error("Disk full"));
    await controller.selectChannel("beta"); expect(controller.getSnapshot().channel).toBe("stable");
    await controller.selectChannel("beta"); expect(controller.getSnapshot().channel).toBe("beta");
  });
});
