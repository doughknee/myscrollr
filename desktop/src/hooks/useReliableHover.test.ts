/**
 * useReliableHover tests — verify the layered hover-state logic that
 * fixes the always-on-top ticker window's stuck-hover bug.
 *
 * Tests cover:
 *   - Pointer enter/leave flips state correctly.
 *   - window.blur clears hover (alt-tab).
 *   - document.visibilitychange when hidden clears hover (Space switch).
 *   - forceClear resets state from outside.
 *   - Pointer move re-arms after a stale clear.
 *
 * The grace-poll backstop is tricky to test deterministically with
 * jsdom's faked focus/visibility; we cover its component pieces
 * (blur and visibilitychange) explicitly.
 */
import { beforeEach, describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReliableHover } from "./useReliableHover";

beforeEach(() => {
  // jsdom exposes these but we still want a fresh hidden state.
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => false,
  });
});

describe("useReliableHover — pointer events", () => {
  it("starts as not hovered", () => {
    const { result } = renderHook(() => useReliableHover());
    expect(result.current.hovered).toBe(false);
  });

  it("flips to hovered on pointer enter", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    expect(result.current.hovered).toBe(true);
  });

  it("clears on pointer leave", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    act(() => result.current.bind.onPointerLeave());
    expect(result.current.hovered).toBe(false);
  });

  it("re-arms hovered on pointer move when previously cleared mid-hover", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    act(() => result.current.bind.onPointerLeave());
    // The grace poll might have cleared between these in real life;
    // a subsequent pointermove should bring it back.
    act(() => result.current.bind.onPointerMove());
    expect(result.current.hovered).toBe(true);
  });
});

describe("useReliableHover — focus loss layer", () => {
  it("clears hover when window.blur fires", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    expect(result.current.hovered).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current.hovered).toBe(false);
  });

  it("clears hover when document becomes hidden", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    expect(result.current.hovered).toBe(true);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.hovered).toBe(false);
  });

  it("does NOT clear when visibilitychange fires but document is still visible", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.hovered).toBe(true);
  });
});

describe("useReliableHover — forceClear", () => {
  it("imperatively resets the hovered state", () => {
    const { result } = renderHook(() => useReliableHover());
    act(() => result.current.bind.onPointerEnter());
    expect(result.current.hovered).toBe(true);
    act(() => result.current.forceClear());
    expect(result.current.hovered).toBe(false);
  });
});
