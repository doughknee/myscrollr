import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChipFlash, useChangeFlash } from "./ChipFlash";

/**
 * Renders the flash driven by a value, so a test can rerender with a
 * new one and assert on what the chip would actually show.
 */
function Probe({ value }: { value: number | null }) {
  const token = useChangeFlash(value);
  return (
    <div data-testid="chip">
      <ChipFlash token={token} />
    </div>
  );
}

const flash = (c: HTMLElement) => c.querySelector(".chip-flash");

describe("useChangeFlash", () => {
  it("does not flash on mount", () => {
    // Every chip scrolling onto the rail has "changed" from nothing. If
    // that counted, the whole bar would strobe on load.
    const { getByTestId } = render(<Probe value={12.4} />);
    expect(flash(getByTestId("chip"))).toBeNull();
  });

  it("does not flash when a value arrives for the first time", () => {
    // FollowedPlayerChip passes null until the player resolves out of a
    // roster. Appearing is not the same as scoring.
    const { getByTestId, rerender } = render(<Probe value={null} />);
    rerender(<Probe value={8.3} />);
    expect(flash(getByTestId("chip"))).toBeNull();
  });

  it("flashes when the value changes", () => {
    const { getByTestId, rerender } = render(<Probe value={8.3} />);
    rerender(<Probe value={14.9} />);
    expect(flash(getByTestId("chip"))).not.toBeNull();
  });

  it("re-keys on each change so the animation can replay", () => {
    // A CSS animation only restarts on a fresh element, so two
    // consecutive scores must not reuse the same node.
    const { getByTestId, rerender } = render(<Probe value={8.3} />);
    rerender(<Probe value={14.9} />);
    const first = flash(getByTestId("chip"));
    rerender(<Probe value={21.5} />);
    expect(flash(getByTestId("chip"))).not.toBe(first);
  });

  it("stays quiet when a rerender does not move the number", () => {
    // The dashboard refetches on a poll; an unchanged score arriving
    // again is not an event.
    const { getByTestId, rerender } = render(<Probe value={8.3} />);
    rerender(<Probe value={8.3} />);
    expect(flash(getByTestId("chip"))).toBeNull();
  });
});
