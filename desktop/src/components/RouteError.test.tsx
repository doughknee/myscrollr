import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import RouteError from "./RouteError";

afterEach(cleanup);

describe("RouteError", () => {
  it("Try again re-runs the failed loader, so the page recovers once the API is back", async () => {
    let apiUp = false;
    let loads = 0;
    const root = createRootRoute();
    const page = createRoute({
      getParentRoute: () => root,
      path: "/",
      loader: () => {
        loads += 1;
        if (!apiUp) throw new Error("forced");
        return "loaded";
      },
      component: () => <p>Page is up</p>,
      errorComponent: RouteError,
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    apiUp = true;
    fireEvent.click(retry);
    expect(await screen.findByText("Page is up")).toBeInTheDocument();
    expect(loads).toBeGreaterThanOrEqual(2);
  });
});
