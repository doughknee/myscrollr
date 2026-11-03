import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateController } from "../../../lib/updateState";
import UpdatesPage from "./UpdatesPage";
import type { UpdateCandidate, UpdateDependencies } from "../../../lib/updateState";

const shared = vi.hoisted(() => ({ controller: null as UpdateController | null }));
vi.mock("../../../lib/updateController", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    updateController: new Proxy({}, { get: (_, key) => shared.controller![key as keyof UpdateController] }),
    useUpdateController: () => useSyncExternalStore(shared.controller!.subscribe, shared.controller!.getSnapshot),
  };
});
vi.mock("../ReleaseNotes", () => ({ default: () => <div>Release history</div> }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));

describe("Updates settings", () => {
  let candidate: UpdateCandidate;
  let deps: UpdateDependencies;
  beforeEach(() => {
    candidate = { version: "1.8.0-beta.1", body: "Beta release notes", download: vi.fn(async () => {}), install: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    deps = { load: vi.fn(async () => ({ version: "1.7.2", channel: "stable", fresh: false })), saveChannel: vi.fn(async () => {}), check: vi.fn(async () => ({ feedVersion: candidate.version, update: candidate })), restart: vi.fn(async () => {}) };
    shared.controller = new UpdateController(deps);
  });
  afterEach(cleanup);
  it("explains opt-in, persists choice, and installs only after explicit action", async () => {
    await act(async () => { render(<UpdatesPage />); });
    expect(screen.getByText(/Switching channels does not install/)).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Beta" })));
    expect(deps.saveChannel).toHaveBeenCalledWith("beta");
    expect(deps.check).not.toHaveBeenCalled(); expect(candidate.download).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(screen.getByText("Beta release notes")).toBeVisible();
    expect(candidate.download).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download & install" })));
    expect(screen.getByRole("button", { name: "Restart now" })).toBeVisible();
  });
  it("retains download progress and pending restart across page navigation", async () => {
    let finish!: () => void;
    vi.mocked(candidate.download).mockImplementation(async progress => {
      progress({ event: "Progress", data: { chunkLength: 1_048_576 } });
      await new Promise<void>(resolve => { finish = resolve; });
    });
    await shared.controller!.initialize(); await shared.controller!.selectChannel("beta"); await shared.controller!.check();
    const first = render(<UpdatesPage />);
    let pending!: Promise<void>;
    await act(async () => { pending = shared.controller!.install(); });
    first.unmount(); render(<UpdatesPage />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("1.0 MB downloaded")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Stable" })).toBeDisabled();
    await act(async () => { finish(); await pending; });
    cleanup(); render(<UpdatesPage />);
    expect(screen.getByRole("button", { name: "Restart now" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Stable" })).toBeDisabled();
    vi.mocked(deps.restart).mockRejectedValue(new Error("Restart failed"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart now" })));
    expect(screen.getByRole("alert")).toHaveTextContent("already installed");
    expect(screen.getByRole("button", { name: "Restart now" })).toBeVisible();
    expect(candidate.download).toHaveBeenCalledTimes(1);
  });
  it("distinguishes unavailable feeds from being current", async () => {
    vi.mocked(deps.check).mockRejectedValue(new Error("Feed unavailable. Please retry later."));
    await act(async () => { render(<UpdatesPage />); });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Feed unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByText(/You have the latest/)).toBeNull();
  });
});
