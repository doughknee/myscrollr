/**
 * SCROLLR-8: the copy-link fallback is the guarantee that a user can
 * always finish sign-in even when the platform opener silently fails to
 * launch a browser (the Linux AppImage case this issue is about). These
 * tests cover the one behavior that matters: the control only appears
 * once there's a link worth copying, and clicking it copies that link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SigningInOverlay from "./SigningInOverlay";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const COPY_LABEL = /copy the sign-in link/i;

describe("SigningInOverlay", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("hides the copy control while no sign-in URL is pending", () => {
    render(<SigningInOverlay authUrl={null} onCancel={() => {}} />);
    expect(screen.queryByText(COPY_LABEL)).toBeNull();
  });

  it("shows the copy control once a sign-in URL is available", () => {
    render(
      <SigningInOverlay
        authUrl="https://auth.myscrollr.com/oidc/auth?foo=bar"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(COPY_LABEL)).toBeTruthy();
  });

  it("copies the URL to the clipboard when clicked", async () => {
    const url = "https://auth.myscrollr.com/oidc/auth?foo=bar";
    render(<SigningInOverlay authUrl={url} onCancel={() => {}} />);
    fireEvent.click(screen.getByText(COPY_LABEL));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
  });

  it("still renders Cancel and calls it back", () => {
    const onCancel = vi.fn();
    render(<SigningInOverlay authUrl={null} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
