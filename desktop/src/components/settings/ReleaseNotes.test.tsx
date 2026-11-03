import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReleaseNotes from "./ReleaseNotes";
import { fetchReleases } from "../../lib/releases";
import type { ReleaseEntry } from "../../lib/releases";
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../lib/releases", async original => ({ ...await original<typeof import("../../lib/releases")>(), fetchReleases: vi.fn() }));
const release = (version: string, prerelease: boolean, date = "2026-11-03"): ReleaseEntry => ({ version, prerelease, tag: `desktop-v${version}`, date, body: "Release notes", name: `Release ${version}`, headline: "New features", url: "https://github.com/doughknee/myscrollr/releases" });
afterEach(cleanup);
beforeEach(() => vi.mocked(fetchReleases).mockResolvedValue([release("1.7.3", false), release("1.7.2", false, "2026-11-04"), release("1.8.0-beta.1", true)]));
describe("release history tabs", () => {
  it("defaults to selected channel and browsing never changes enrollment", async () => {
    const props = { channel: "beta" as const, installedVersion: "1.8.0-beta.1", approvedVersion: "1.8.0-beta.1" };
    await act(async () => { render(<ReleaseNotes {...props} />); });
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Installed")).toBeVisible();
    expect(screen.queryByText("v1.7.3")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Stable" }));
    expect(screen.getByText("v1.7.3")).toBeVisible();
    expect(screen.queryByText("Installed")).toBeNull();
    expect(screen.getByText("Newest Stable").closest("button")).toHaveTextContent("v1.7.3");
    expect(props.channel).toBe("beta");
  });
  it("supports keyboard navigation and empty channels", async () => {
    vi.mocked(fetchReleases).mockResolvedValue([release("1.7.3", false)]);
    await act(async () => { render(<ReleaseNotes />); });
    const tab = screen.getByRole("tab", { name: "Stable" }); tab.focus();
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    expect(screen.getByText(/No Beta releases/)).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "Home" });
    expect(tab).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /v1.7.3/ }));
    expect(screen.getByText("Release notes")).toBeVisible();
  });
  it("can mark a Stable release approved for Beta subscribers", async () => {
    await act(async () => { render(<ReleaseNotes channel="beta" approvedVersion="1.7.3" />); });
    fireEvent.click(screen.getByRole("tab", { name: "Stable" }));
    expect(screen.getByText("Approved for Beta")).toBeVisible();
  });
});
