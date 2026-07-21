import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TickerLayoutSummary from "./TickerLayoutSummary";
import type { DataWidgetManifest, WidgetManifest } from "../types";

const dataWidgetManifests = [
  { id: "finance", tabLabel: "Finance", hex: "#22c55e" },
] as DataWidgetManifest[];

const widgetManifests = [
  { id: "timer", tabLabel: "Timer", hex: "#38bdf8" },
] as WidgetManifest[];

describe("TickerLayoutSummary", () => {
  it("shows the current layout without exposing Home-side row mutations", () => {
    render(
      <TickerLayoutSummary
        rows={[{ sources: ["finance"] }]}
        tierMaxRows={3}
        canAddRow={true}
        onOpenSettings={vi.fn()}
        dataWidgetManifests={dataWidgetManifests}
        widgetManifests={widgetManifests}
      />,
    );

    expect(screen.getByText("Ticker layout")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the full ticker layout editor/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add a new ticker row/i })).not.toBeInTheDocument();
  });

  it("describes empty rows as all ticker-enabled sources", () => {
    render(
      <TickerLayoutSummary
        rows={[{ sources: [] }]}
        tierMaxRows={1}
        canAddRow={false}
        onOpenSettings={vi.fn()}
        dataWidgetManifests={dataWidgetManifests}
        widgetManifests={widgetManifests}
      />,
    );

    expect(screen.getByText("All ticker-enabled sources")).toBeInTheDocument();
  });
});
