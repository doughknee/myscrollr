import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AccountExportButton from "./AccountExportButton";

vi.mock("../../api/client", () => ({
  exportUserData: vi.fn().mockResolvedValue(new Blob(["test"], { type: "application/zip" })),
}));

describe("AccountExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the button in idle state", () => {
    render(<AccountExportButton />);
    expect(screen.getByRole("button", { name: /download my data/i })).toBeInTheDocument();
  });

  it("shows loading state when clicked", async () => {
    render(<AccountExportButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText(/preparing/i)).toBeInTheDocument();
    });
  });

  it("renders error state when fetch fails", async () => {
    const { exportUserData } = await import("../../api/client");
    vi.mocked(exportUserData).mockRejectedValueOnce(new Error("network down"));

    render(<AccountExportButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    });
  });
});
