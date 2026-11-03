import { describe, expect, it, vi } from "vitest";
import { UpdateController } from "./updateState";
import type { UpdateCandidate, UpdateDependencies } from "./updateState";

async function setup() {
  const candidate: UpdateCandidate = { version: "1.7.3", download: vi.fn(async () => {}), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const deps: UpdateDependencies = {
    load: async () => ({ version: "1.8.0-beta.1", channel: "stable", fresh: false }),
    saveChannel: vi.fn(async () => {}), restart: vi.fn(async () => {}),
    check: vi.fn(async () => ({ feedVersion: "1.7.3", update: null, recoveryVersion: "1.7.3" })),
    prepareRecovery: vi.fn(async () => ({ feedVersion: "1.7.3", recoveryVersion: "1.7.3", update: candidate })),
  };
  const controller = new UpdateController(deps);
  await controller.check();
  return { candidate, deps, controller };
}
describe("explicit Stable recovery", () => {
  it("checking and reviewing cannot install; confirmation uses a separate action", async () => {
    const { controller, candidate, deps } = await setup();
    await controller.install();
    expect(deps.prepareRecovery).not.toHaveBeenCalled();
    await controller.prepareRecovery();
    const offer = controller.getSnapshot().offerId;
    await controller.install(offer);
    expect(candidate.download).not.toHaveBeenCalled();
    await controller.check(); await controller.selectChannel("beta");
    expect(controller.getSnapshot()).toMatchObject({ phase: "recovery", channel: "stable" });
    await controller.installRecovery(offer);
    expect(candidate.install).toHaveBeenCalledTimes(1);
    expect(deps.saveChannel).toHaveBeenCalledWith("stable");
    expect(controller.getSnapshot().phase).toBe("ready");
  });
  it("cancel closes the resource and invalidates confirmation", async () => {
    const { controller, candidate } = await setup();
    await controller.prepareRecovery(); const stale = controller.getSnapshot().offerId;
    await controller.cancelRecovery();
    expect(controller.getSnapshot().phase).toBe("waiting");
    expect(candidate.close).toHaveBeenCalledTimes(1);
    await controller.prepareRecovery(); await controller.installRecovery(stale);
    expect(candidate.download).not.toHaveBeenCalled();
  });
  it("refuses a changed or withdrawn recovery offer", async () => {
    const { controller, deps, candidate } = await setup();
    vi.mocked(deps.prepareRecovery!).mockResolvedValue({ feedVersion: "1.7.4", recoveryVersion: "1.7.4", update: candidate });
    await controller.prepareRecovery();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(candidate.close).toHaveBeenCalled();
    expect(candidate.download).not.toHaveBeenCalled();
  });
  it("blocks recovery below the minimum, including changes during download", async () => {
    const { controller, candidate } = await setup();
    await controller.prepareRecovery();
    vi.mocked(candidate.download).mockImplementation(async () => { controller.setMinimum("1.8.0"); });
    await controller.installRecovery(controller.getSnapshot().offerId);
    expect(candidate.install).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("error");
  });
  it.each(["download", "save"])("does not install after a %s failure", async failure => {
    const { controller, candidate, deps } = await setup();
    await controller.prepareRecovery();
    if (failure === "download") vi.mocked(candidate.download).mockRejectedValue(new Error("bad signature"));
    else vi.mocked(deps.saveChannel).mockRejectedValue(new Error("disk full"));
    await controller.installRecovery(controller.getSnapshot().offerId);
    expect(candidate.install).not.toHaveBeenCalled();
    expect(candidate.close).toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe("error");
  });
  it("does not accept an ordinary downgrade as an update", async () => {
    const { controller, deps, candidate } = await setup();
    vi.mocked(deps.check).mockResolvedValue({ feedVersion: "1.7.3", update: candidate });
    await controller.check(); await controller.install();
    expect(controller.getSnapshot().phase).toBe("error");
    expect(candidate.download).not.toHaveBeenCalled();
  });
});
