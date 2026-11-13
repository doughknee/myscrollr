import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { openExternal } from "./openExternal";

describe("openExternal", () => {
  it("hands the link to the Rust open_external command", async () => {
    await openExternal("https://myscrollr.com/uplink");
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://myscrollr.com/uplink" });
  });

  it("rejects when the command refuses the link, so callers can fall back", async () => {
    invoke.mockRejectedValueOnce("Only http and https links can be opened");
    await expect(openExternal("mailto:a@b.c")).rejects.toBeTruthy();
  });
});
