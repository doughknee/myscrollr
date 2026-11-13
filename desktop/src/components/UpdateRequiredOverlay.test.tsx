import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-shell";
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
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));

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
    expect(open).toHaveBeenCalledWith("https://myscrollr.com/download");
  });
});
