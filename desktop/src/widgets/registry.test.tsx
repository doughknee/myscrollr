/**
 * The ticker window reads the registry for names, colours and icons only
 * (SCROLLR-408): feed screens are fetched when a widget's page opens.
 */
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const loaded = vi.hoisted(() => [] as string[]);
vi.mock("./clock/FeedTab", () => {
  loaded.push("clock");
  return { default: () => <p>clock screen</p> };
});

import { getAllWidgets, getWidget } from "./registry";

describe("widget registry", () => {
  it("lists every utility without loading a feed screen", () => {
    expect(getAllWidgets().map((w) => w.id)).toEqual(["clock", "timer", "weather", "sysmon", "uptime", "github"]);
    expect(getWidget("clock")).toMatchObject({ name: "Clock", tabLabel: "Clock" });
    expect(loaded).toEqual([]);
  });

  it("loads the screen when it is rendered, behind Suspense", async () => {
    const { FeedTab } = getWidget("clock")!;
    render(
      <Suspense fallback={<p>loading</p>}>
        <FeedTab mode="comfort" feedContext={{}} />
      </Suspense>,
    );
    expect(await screen.findByText("clock screen")).toBeTruthy();
    expect(loaded).toEqual(["clock"]);
  });
});
