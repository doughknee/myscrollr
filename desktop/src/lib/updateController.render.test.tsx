/**
 * A download is one snapshot per chunk (SCROLLR-429). A subscriber that does not
 * show progress, like the app shell, must not render for each of them.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ feedVersion: "1.8.0", update: { version: "1.8.0" } })),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.7.2" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));
const chunk = vi.hoisted(() => ({ send: (_e: unknown) => {}, finish: () => {} }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  Update: class {
    version = "1.8.0";
    download = (progress: (e: unknown) => void) =>
      new Promise<void>((resolve) => {
        chunk.send = progress;
        chunk.finish = resolve;
      });
    install = async () => {};
    close = async () => {};
  },
}));
vi.mock("./store", () => ({
  FRESH_INSTALL_KEY: "fresh",
  getStore: () => false,
  initStore: async () => {},
  readStoreShared: async () => "stable",
  setStorePersisted: async () => {},
  removeStorePersisted: async () => {},
}));

import { updateController, useUpdateController } from "./updateController";

const renders = { shell: 0, progress: 0 };
function Shell() {
  const s = useUpdateController((x) => ({ phase: x.phase }));
  renders.shell++;
  return <p>shell {s.phase}</p>;
}
function Progress() {
  const s = useUpdateController();
  renders.progress++;
  return <p>{s.downloaded} bytes</p>;
}

describe("useUpdateController selector", () => {
  it("renders a narrow subscriber per phase, not per download chunk", async () => {
    render(<><Shell /><Progress /></>);
    await act(async () => {
      await updateController.check();
    });
    let install!: Promise<void>;
    await act(async () => {
      install = updateController.install();
    });
    await act(async () => chunk.send({ event: "Started", data: { contentLength: 1000 } }));
    // One snapshot per chunk, each in its own render pass, as they arrive from the native side.
    for (let i = 0; i < 20; i++) await act(async () => chunk.send({ event: "Progress", data: { chunkLength: 50 } }));
    await act(async () => {
      chunk.finish();
      await install;
    });
    expect(screen.getByText("shell ready")).toBeTruthy();
    expect(screen.getByText("1000 bytes")).toBeTruthy();
    // initializing, idle, checking, available, downloading, installing, ready and a few first renders.
    expect(renders.shell).toBeLessThan(12);
    // The component that shows progress sees every chunk.
    expect(renders.progress).toBeGreaterThan(renders.shell + 15);
  });
});
