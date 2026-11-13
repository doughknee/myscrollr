// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { openExternal, openLinkOnClick } from "./openExternal";

describe("openExternal", () => {
  it("hands the link to the Rust open_external command", async () => {
    await openExternal("https://myscrollr.com/uplink");
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://myscrollr.com/uplink" });
  });

  it("rejects when the command refuses the link, so callers can fall back", async () => {
    invoke.mockRejectedValueOnce("Only http and https links can be opened");
    await expect(openExternal("mailto:a@b.c")).rejects.toBeTruthy();
  });

  it("opens a clicked link through the command instead of letting the webview follow it", () => {
    const event = { preventDefault: vi.fn(), currentTarget: { href: "https://example.com/a" } };
    openLinkOnClick(event as never);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.com/a" });
  });

  it("opens a middle-click through the command, and ignores the right button", () => {
    const href = "https://example.com/m";
    const right = { type: "auxclick", button: 2, preventDefault: vi.fn(), currentTarget: { href } };
    openLinkOnClick(right as never);
    expect(right.preventDefault).not.toHaveBeenCalled();
    invoke.mockClear();
    const middle = { type: "auxclick", button: 1, preventDefault: vi.fn(), currentTarget: { href } };
    openLinkOnClick(middle as never);
    expect(middle.preventDefault).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("open_external", { url: href });
  });

  // SCROLLR-470: the shell plugin's injected script turns every click on a
  // target="_blank" link into `shell.open`, which the app does not allow, so
  // the link opens nothing. Outside links use `openLinkOnClick` instead.
  it("no source file gives a link target=\"_blank\"", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    const offenders = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /target\s*=\s*\{?\s*["'`]_blank/.test(readFileSync(join(src, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
