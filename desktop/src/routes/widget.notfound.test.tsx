import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./widget.$id.index";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  Element.prototype.scrollTo = () => {};
});
afterEach(cleanup);

describe("unknown widget route", () => {
  it("says so in the empty-state style and leads back to the catalog", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["dashboard"], {});
    const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()();
    const widget = Route.update({ id: "/widget/$id/", path: "/widget/$id/", getParentRoute: () => rootRoute } as never);
    const catalog = createRoute({ getParentRoute: () => rootRoute, path: "/catalog", component: () => <p>Catalog page</p> });
    const router = createRouter({
      routeTree: rootRoute.addChildren([widget, catalog]),
      history: createMemoryHistory({ initialEntries: ["/widget/retired_thing"] }),
      context: { queryClient },
    });
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "Widget not found" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse the Catalog" }));
    expect(await screen.findByText("Catalog page")).toBeInTheDocument();
  });
});
