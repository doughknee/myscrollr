import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoPagination } from "./feedHooks";

let intersect: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

function Harness({ filter = "all" }: { filter?: string }) {
  const { visible, footer } = useAutoPagination(45, [filter], "py-2");
  return (
    <div data-page-scroll>
      <output>{visible}</output>
      {footer}
    </div>
  );
}

it("reveals the next local page at the scroll boundary and resets on filters", () => {
  const view = render(<Harness />);

  expect(screen.getByText("20")).toBeInTheDocument();
  act(() => intersect?.());
  expect(screen.getByText("40")).toBeInTheDocument();

  view.rerender(<Harness filter="watchlist" />);
  expect(screen.getByText("20")).toBeInTheDocument();
});
