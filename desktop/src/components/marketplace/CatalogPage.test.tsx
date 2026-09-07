/**
 * Catalog route — hub ↔ directory over the URL, against the bundled
 * snapshot catalog (REL-215). The real `Route` is mounted under a test
 * root that stands in for RootLayout's providers, so search-param
 * handling is the production code, not a re-statement of it. Lives here
 * rather than in routes/ because the router plugin treats every file
 * there as a route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Route } from "../../routes/catalog";
import { buildBlocks } from "./CatalogDirectory";
import { getCatalogItems } from "../../marketplace";
import { ShellContext, ShellDataContext } from "../../shell-context";
import { BarChassisProvider, BarChassisSlot } from "../widget-bar/BarChassis";
import type { ShellState } from "../../shell-context";
import { loadPrefs } from "../../preferences";
import type { SubscriptionTier } from "../../auth";
import type { DataWidgetRow } from "../../api/client";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(() => Promise.reject(new Error("no tauri in tests"))),
}));
vi.mock("../../api/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../api/client")>();
  return {
    ...mod,
    requestCatalogWidget: vi.fn(async (query: string) => ({ query, count: 3 })),
  };
});

const row = (widget_type: string): DataWidgetRow => ({
  id: 1,
  widget_type,
  enabled: true,
  ticker_enabled: true,
  config: {},
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

function mount(
  path: string,
  opts: { tier?: SubscriptionTier; widgets?: string[]; authenticated?: boolean } = {},
) {
  // Defaults enable a few utilities; the slot maths below wants a clean sheet.
  const base = loadPrefs();
  const prefs = {
    ...base,
    widgets: { ...base.widgets, enabledWidgets: [], widgetsOnTicker: [] },
  };
  const shell: ShellState = {
    prefs,
    onPrefsChange: vi.fn(),
    authenticated: opts.authenticated ?? true,
    tier: opts.tier ?? "super_user",
    subscriptionInfo: null,
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    autostartEnabled: false,
    onAutostartChange: vi.fn(),
    appVersion: "test",
    allDataWidgetManifests: [],
    allWidgets: [],
  };
  const widgets = (opts.widgets ?? []).map(row);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The chassis is active on /catalog in the app, so the directory's bar
  // row goes through the portal here too — that is where REL-218 lived.
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ShellContext.Provider value={shell}>
          <ShellDataContext.Provider value={{ widgets, dashboard: undefined }}>
            <BarChassisProvider active>
              <BarChassisSlot />
              <Outlet />
            </BarChassisProvider>
          </ShellDataContext.Provider>
        </ShellContext.Provider>
      </QueryClientProvider>
    ),
  });
  // Same wiring the generated route tree does for the file route.
  const catalog = Route.update({
    id: "/catalog",
    path: "/catalog",
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([catalog]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return { router, shell };
}

// jsdom has no IntersectionObserver (the WidgetBar's pinned-shadow
// sentinel) and no Element.scrollTo (PageLayout's scroll reset).
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  Element.prototype.scrollTo = () => {};
});

describe("hub", () => {
  it("lands on the hub with one tile per kind and the slot line", async () => {
    mount("/catalog", { tier: "free", widgets: ["sports_nfl"] });
    expect(
      await screen.findByRole("heading", { name: "What do you want on your ticker?" }),
    ).toBeInTheDocument();
    // Sports tile carries its count and the added count.
    const sports = screen.getByRole("button", { name: /^Sports, \d+ widgets$/ });
    expect(within(sports).getByText("1 added")).toBeInTheDocument();
    expect(screen.getByText("Something else?")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 slots used")).toBeInTheDocument();
    // In your ticker lists the added widget (the Try chip is the other one).
    expect(screen.getAllByRole("button", { name: "NFL" })).toHaveLength(2);
  });

  it("flags the free-tier cap on the hub line", async () => {
    mount("/catalog", {
      tier: "free",
      widgets: ["sports_nfl", "sports_nba", "finance_stocks"],
    });
    expect(await screen.findByText("3 of 3 slots used")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade for unlimited" })).toBeInTheDocument();
  });

  it("a tile opens that kind's directory with the query cleared", async () => {
    const { router } = mount("/catalog");
    fireEvent.click(await screen.findByRole("button", { name: /^Sports, \d+ widgets$/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ kind: "sports" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sports" })).toBeInTheDocument();
  });

  it("typing in the hero drops into search results", async () => {
    const { router } = mount("/catalog");
    fireEvent.change(await screen.findByLabelText("Search widgets"), {
      target: { value: "soccer" },
    });
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "soccer" }));
  });

  // REL-218: the first character swaps the hub's field for the
  // directory's. Keys go to whatever is focused, so every character
  // after the first is lost unless the new field takes the focus.
  it("keeps every keystroke and the focus across the hub → directory swap", async () => {
    const { router } = mount("/catalog");
    const user = userEvent.setup({ delay: 40 });
    await user.click(await screen.findByLabelText("Search widgets"));
    await user.keyboard("bit");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "bit" }));
    const field = screen.getByLabelText<HTMLInputElement>("Search widgets");
    expect(field).toHaveValue("bit");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe(3);
    expect(await screen.findByText("Crypto")).toBeInTheDocument();

    // Backspace to empty: the last kind, still this field, still focused.
    await user.keyboard("{Backspace}{Backspace}{Backspace}");
    await waitFor(() => expect(router.state.location.search).toEqual({ kind: "all" }));
    expect(screen.getByLabelText("Search widgets")).toBe(field);
    expect(field).toHaveFocus();
  });

  it("a Try chip opens the directory with the query in a focused field", async () => {
    const { router } = mount("/catalog");
    fireEvent.click(await screen.findByRole("button", { name: "Bitcoin" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "Bitcoin" }));
    const field = screen.getByLabelText<HTMLInputElement>("Search widgets");
    expect(field).toHaveValue("Bitcoin");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe("Bitcoin".length);
  });
});

describe("directory", () => {
  it("shows a kind with group headers and the rail", async () => {
    mount("/catalog?kind=sports");
    expect(await screen.findByRole("heading", { level: 1, name: "Sports" })).toBeInTheDocument();
    // Sports has enough widgets for group headers.
    expect(screen.getByRole("heading", { level: 2, name: "Soccer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Football" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Kinds" });
    expect(within(rail).getByRole("button", { name: /All widgets/ })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Sports/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(rail).getByText("Your ticker")).toBeInTheDocument();
  });

  it("a search hit groups results by kind and hides group headers", async () => {
    mount("/catalog?q=soccer");
    expect(await screen.findByRole("heading", { level: 1, name: "Sports" })).toBeInTheDocument();
    // The bar's summary and each block's sub both count matches.
    expect(screen.getAllByText(/\d+ matches/).length).toBeGreaterThan(1);
    expect(screen.queryByRole("heading", { level: 2, name: "Soccer" })).not.toBeInTheDocument();
    expect(screen.getByText("Premier League")).toBeInTheDocument();
    expect(screen.queryByText("NFL")).not.toBeInTheDocument();
  });

  it("a miss shows the request card and the closest group", async () => {
    mount("/catalog?q=Eredivisie");
    expect(await screen.findByText("No “Eredivisie” widget yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Closest matches" })).toBeInTheDocument();
    expect(screen.getByText("Soccer")).toBeInTheDocument();
    expect(screen.getByText("Premier League")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Request Eredivisie" }));
    expect(await screen.findByText(/3 people have asked/)).toBeInTheDocument();
  });

  it("picking a rail kind clears the query; clearing the field keeps the kind", async () => {
    const { router } = mount("/catalog?kind=news&q=soccer");
    const rail = await screen.findByRole("navigation", { name: "Kinds" });
    fireEvent.click(within(rail).getByRole("button", { name: /Finance/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ kind: "finance" }));

    fireEvent.change(screen.getByLabelText("Search widgets"), { target: { value: "btc" } });
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ kind: "finance", q: "btc" }),
    );
    expect(await screen.findByText("Crypto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search widgets"), { target: { value: "" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ kind: "finance" }));
  });

  it("Overview returns to the hub", async () => {
    const { router } = mount("/catalog?kind=sports");
    fireEvent.click(await screen.findByRole("button", { name: "Overview" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(
      await screen.findByRole("heading", { name: "What do you want on your ticker?" }),
    ).toBeInTheDocument();
  });

  it("reads the cap on the rail and the bar, and the ✓ is a remove button", async () => {
    mount("/catalog?kind=sports", {
      tier: "free",
      widgets: ["sports_nfl", "sports_nba", "finance_stocks"],
    });
    const rail = await screen.findByRole("navigation", { name: "Kinds" });
    expect(within(rail).getByText("3/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All 3 slots used/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove NFL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add NHL" })).toBeInTheDocument();
  });
});

describe("buildBlocks sorts", () => {
  const items = getCatalogItems().filter((i) => !i.hidden);
  const none = new Set<string>();

  it("A–Z flattens a kind into one alphabetical shelf", () => {
    const { blocks } = buildBlocks(items, "sports", "", "az", none);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].showHeads).toBe(false);
    const names = blocks[0].shelves[0].items.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("newest-first is one block across every kind, dated first", () => {
    const { blocks } = buildBlocks(items, "all", "", "new", none);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("Newest first");
    // The newest dated entry: the REL-220 league expansion (2026-09-06),
    // whose first declared entry is the Bundesliga.
    expect(blocks[0].shelves[0].items[0].id).toBe("sports_bundesliga");
  });

  it("by kind shelves Sports by group with headers, Finance without", () => {
    const sports = buildBlocks(items, "sports", "", undefined, none).blocks[0];
    expect(sports.showHeads).toBe(true);
    expect(sports.shelves.map((s) => s.key)).toContain("Soccer");
    const finance = buildBlocks(items, "finance", "", undefined, none).blocks[0];
    expect(finance.showHeads).toBe(false);
  });
});
