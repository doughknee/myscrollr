import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  enable: vi.fn(),
  shared: vi.fn(),
  removed: vi.fn(),
  tip: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: m.enable }));
vi.mock("./store", () => ({
  FRESH_INSTALL_KEY: "scrollr:fresh-install",
  readStoreShared: m.shared,
  removeStorePersisted: m.removed,
}));
vi.mock("./tips", () => ({
  TIP_IDS: { AUTOSTART_DEFAULT: "autostart-default" },
  showTipOnce: m.tip,
}));

import { applyAutostartDefault } from "./autostartDefault";

const prefs = { tipsShown: [] } as unknown as Parameters<typeof applyAutostartDefault>[0];
const run = () => applyAutostartDefault(prefs, vi.fn(), vi.fn());

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.enable.mockResolvedValue(undefined);
  m.removed.mockResolvedValue(undefined);
});

describe("applyAutostartDefault", () => {
  it("fresh install: clears the marker, enables once, shows the tip", async () => {
    m.shared.mockResolvedValue(true);
    expect(await run()).toBe(true);
    expect(m.removed).toHaveBeenCalledWith("scrollr:fresh-install");
    expect(m.enable).toHaveBeenCalledTimes(1);
    expect(m.tip).toHaveBeenCalledTimes(1);
    expect(m.removed.mock.invocationCallOrder[0]).toBeLessThan(
      m.enable.mock.invocationCallOrder[0],
    );
  });

  it("existing install (no marker): does nothing", async () => {
    m.shared.mockResolvedValue(undefined);
    expect(await run()).toBe(false);
    expect(m.enable).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();
  });

  it("user turned it off after the default: never re-enabled", async () => {
    m.shared.mockResolvedValueOnce(true).mockResolvedValue(undefined);
    await run(); // first launch applies the default
    m.enable.mockClear();
    m.tip.mockClear();
    await run(); // every later launch: marker gone
    await run();
    expect(m.enable).not.toHaveBeenCalled();
    expect(m.tip).not.toHaveBeenCalled();
  });

  it("enable() rejects: no crash, no tip, logged, not retried", async () => {
    m.shared.mockResolvedValueOnce(true).mockResolvedValue(undefined);
    m.enable.mockRejectedValue(new Error("no desktop entry"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toBe(false);
    expect(m.tip).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(m.removed).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
