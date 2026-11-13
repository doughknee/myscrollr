/**
 * The two empty states, in both bars (SCROLLR-274): the continuous bar
 * draws the bare row, the pages bar draws it beside its label block.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Newspaper } from "lucide-react";
import EmptyBar from "./EmptyBar";

const installed = [{ id: "rss", name: "News", hex: "#34d399", icon: Newspaper }];

describe("EmptyBar", () => {
  it("sourceless: the catalog CTA works in both bars", () => {
    for (const pages of [false, true]) {
      const onAddSources = vi.fn();
      const { container, unmount } = render(<EmptyBar kind="sourceless" pages={pages} onAddSources={onAddSources} />);
      fireEvent.click(screen.getByRole("button", { name: /browse the catalog/i }));
      expect(onAddSources).toHaveBeenCalledOnce();
      expect(Boolean(container.querySelector("[data-label=empty]"))).toBe(pages);
      expect(Boolean(container.querySelector("[data-pages]"))).toBe(pages);
      unmount();
    }
  });

  it("failed: says the data could not load, never 'no sources', and retries (SCROLLR-406)", () => {
    for (const pages of [false, true]) {
      const onRetry = vi.fn();
      const { container, unmount } = render(<EmptyBar kind="failed" pages={pages} onRetry={onRetry} />);
      expect(screen.getByText(/couldn.t load your sources/i)).toBeTruthy();
      expect(screen.queryByText(/haven.t added any sources/i)).toBeNull();
      expect(container.querySelector("[data-empty=failed]")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(onRetry).toHaveBeenCalledOnce();
      unmount();
    }
  });

  it("installed-off: one quick-link per widget opens that widget", () => {
    const onOpenWidget = vi.fn();
    render(<EmptyBar kind="installedOff" pages installedWidgets={installed} onOpenWidget={onOpenWidget} />);
    expect(screen.getByText(/ticker is empty/i)).toBeTruthy();
    fireEvent.click(screen.getByTitle("Open News"));
    expect(onOpenWidget).toHaveBeenCalledWith("rss");
  });
});
