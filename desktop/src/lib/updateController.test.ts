import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveUpdateChannel, UPDATE_CHANNEL_KEY } from "./updateController";
import { readStoreShared, setStorePersisted, removeStorePersisted } from "./store";

vi.mock("./store", () => ({ FRESH_INSTALL_KEY: "fresh", getStore: vi.fn(), initStore: vi.fn(),
  readStoreShared: vi.fn(), setStorePersisted: vi.fn(), removeStorePersisted: vi.fn() }));

describe("channel preference persistence", () => {
  beforeEach(() => vi.resetAllMocks());
  it("restores the shared store after a failed disk flush, not just controller state", async () => {
    let nativeChannel = "stable";
    vi.mocked(readStoreShared).mockImplementation(async () => nativeChannel as never);
    vi.mocked(setStorePersisted).mockImplementation(async (_key, value) => {
      nativeChannel = String(value);
      if (value === "beta") throw new Error("Disk full after memory changed");
    });
    await expect(saveUpdateChannel("beta")).rejects.toThrow("previous choice was restored");
    expect(nativeChannel).toBe("stable");
    expect(setStorePersisted).toHaveBeenLastCalledWith(UPDATE_CHANNEL_KEY, "stable");
  });
  it("removes an unsaved first-install default when there was no previous preference", async () => {
    vi.mocked(readStoreShared).mockResolvedValue(undefined);
    vi.mocked(setStorePersisted).mockRejectedValue(new Error("Save failed"));
    await expect(saveUpdateChannel("beta")).rejects.toThrow("previous choice was restored");
    expect(removeStorePersisted).toHaveBeenCalledWith(UPDATE_CHANNEL_KEY);
  });
  it("reports a failed rollback explicitly", async () => {
    vi.mocked(readStoreShared).mockResolvedValue("stable");
    vi.mocked(setStorePersisted).mockRejectedValue(new Error("Store unavailable"));
    await expect(saveUpdateChannel("beta")).rejects.toThrow("Restart Scrollr and verify your channel");
  });
});
