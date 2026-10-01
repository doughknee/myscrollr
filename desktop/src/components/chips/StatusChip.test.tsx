import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusChip from "./StatusChip";

// CHIP_SPEC §8.7: two cells, the subtle palette, width from a sizer that
// holds the widest message, and a detail row that adds nothing.
describe("StatusChip", () => {
  const props = { tab: "EPL", text: "off-season", reserve: "next match Wed, Sep 28, 10:59 PM" };

  it("reserves the widest message in a hidden sizer in the text column", () => {
    render(<StatusChip {...props} />);
    const sizer = screen.getByText(props.reserve);
    expect(sizer).toHaveAttribute("aria-hidden");
    expect(sizer.classList.contains("invisible")).toBe(true);
    expect(sizer.classList.contains("col-start-2")).toBe(true);
    expect(screen.getByText("off-season").closest("span.col-start-2")).not.toBeNull();
  });

  it("has the bar's two rows, the second empty", () => {
    render(<StatusChip {...props} />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.classList.contains("grid-rows-[30px_20px]")).toBe(true);
    expect(chip.querySelector(".row-start-2")).toBeNull();
  });

  it("uses the subtle palette, never red", () => {
    render(<StatusChip {...props} />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.className).toContain("border-edge");
    expect(chip.className).not.toMatch(/live|error|down/);
  });
});
