import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternal } from "../lib/openExternal";
import { UpdateController } from "../lib/updateState";
import { UpdateRequiredOverlay } from "./UpdateRequiredOverlay";

const shared = vi.hoisted(() => ({ controller: null as UpdateController | null }));
vi.mock("../lib/updateController", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    updateController: new Proxy({}, { get: (_, key) => shared.controller![key as keyof UpdateController] }),
    useUpdateController: () => useSyncExternalStore(shared.controller!.subscribe, shared.controller!.getSnapshot),
  };
});
vi.mock("../lib/openExternal", () => ({ openExternal: vi.fn(async () => {}) }));

const RAW = "error sending request for url (https://github.com/x/latest.json): dns error";

describe("UpdateRequiredOverlay", () => {
  beforeEach(() => {
    shared.controller = new UpdateController({
      load: async () => ({ version: "1.7.0", channel: "stable", fresh: false }),
      saveChannel: async () => {},
      check: async () => { throw new Error(RAW); },
      restart: async () => {},
    });
  });
  afterEach(cleanup);

  it("renders the action with real button styles (no undefined daisyUI classes)", () => {
    render(<UpdateRequiredOverlay appVersion="1.7.0" minVersion="99.0.0" />);
    const cls = screen.getByRole("button", { name: "Update now" }).className.split(" ");
    expect(cls).toContain("bg-accent");
    expect(cls).not.toContain("btn");
    expect(cls).not.toContain("btn-primary");
  });

  it("a failed check says what happened in plain words and offers the installer page", async () => {
    render(<UpdateRequiredOverlay appVersion="1.7.0" minVersion="99.0.0" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update now" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Scrollr could not check for updates.");
    // raw native text is inside the closed disclosure, not the sentence
    expect(screen.getByText(RAW).closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Download the installer instead" }));
    expect(openExternal).toHaveBeenCalledWith("https://myscrollr.com/download");
  });

  it("uses the app's own colour tokens, not the legacy base-* / primary aliases", () => {
    const here = (f: string) => new URL(f, import.meta.url);
    const css = readFileSync(here("../style.css"), "utf8");
    const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    const src = readFileSync(here("./UpdateRequiredOverlay.tsx"), "utf8");
    const used = [...src.matchAll(/\b(?:bg|text|border)-((?:surface|edge|fg|accent|error|base|primary)[a-z0-9-]*)(?:\/\d+)?/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((name) => !defined.has(name) || /^(base|primary)/.test(name))).toEqual([]);
  });
});
