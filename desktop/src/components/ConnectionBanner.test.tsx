/**
 * The bug these cover: a reconnecting SSE stream flaps
 * polling -> sse -> polling every few seconds. The banner reacted to
 * every flip, so it strobed at the top of the widget, and each
 * momentary "sse" cleared the stored dismissal — meaning a banner the
 * user had just dismissed came straight back and could not be got rid
 * of while the stream was bouncing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import ConnectionBanner from "./ConnectionBanner";

const POLLING = /Live updates paused/i;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("ConnectionBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet while the stream is healthy", () => {
    render(<ConnectionBanner deliveryMode="sse" />);
    advance(10_000);
    expect(screen.queryByText(POLLING)).toBeNull();
  });

  it("does not flash for a blip shorter than the show delay", () => {
    const { rerender } = render(<ConnectionBanner deliveryMode="sse" />);
    rerender(<ConnectionBanner deliveryMode="polling" />);
    advance(2_000); // still inside the delay
    expect(screen.queryByText(POLLING)).toBeNull();

    rerender(<ConnectionBanner deliveryMode="sse" />);
    advance(10_000);
    expect(screen.queryByText(POLLING)).toBeNull();
  });

  it("explains a degraded mode that actually holds", () => {
    const { rerender } = render(<ConnectionBanner deliveryMode="sse" />);
    rerender(<ConnectionBanner deliveryMode="polling" />);
    advance(5_000);
    expect(screen.getByText(POLLING)).toBeTruthy();
  });

  it("stays dismissed while the stream flaps — the reported bug", () => {
    const { rerender } = render(<ConnectionBanner deliveryMode="polling" />);
    advance(5_000);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(POLLING)).toBeNull();

    // Three reconnect blips, none long enough to count as recovery.
    for (let i = 0; i < 3; i++) {
      rerender(<ConnectionBanner deliveryMode="sse" />);
      advance(3_000);
      rerender(<ConnectionBanner deliveryMode="polling" />);
      advance(6_000);
      expect(screen.queryByText(POLLING)).toBeNull();
    }
  });

  it("re-notifies after the stream genuinely recovers and drops again", () => {
    const { rerender } = render(<ConnectionBanner deliveryMode="polling" />);
    advance(5_000);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    // Healthy long enough to count as a real recovery. Advanced in two
    // steps: the recovery timer is scheduled by an effect that only
    // runs once the debounced mode has settled, so a single advance
    // would finish before that timer even exists.
    rerender(<ConnectionBanner deliveryMode="sse" />);
    advance(100); // let settledMode flip to "sse"
    advance(70_000); // now outlast RECOVERY_HOLD_MS

    rerender(<ConnectionBanner deliveryMode="polling" />);
    advance(5_000);
    expect(screen.getByText(POLLING)).toBeTruthy();
  });

  it("treats a different degraded mode as its own notification", () => {
    const { rerender } = render(<ConnectionBanner deliveryMode="polling" />);
    advance(5_000);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(POLLING)).toBeNull();

    // offline ≠ polling, so dismissing one must not silence the other.
    rerender(<ConnectionBanner deliveryMode="offline" />);
    advance(5_000);
    expect(screen.getByText(/You appear to be offline/i)).toBeTruthy();
  });
});
