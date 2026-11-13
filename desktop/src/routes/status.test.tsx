import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./status";

const api = vi.hoisted(() => ({ fetchHealth: vi.fn() }));
vi.mock("../api/client", () => ({ fetchHealth: api.fetchHealth }));
vi.mock("../hooks/useTauriListener", () => ({ useTauriListener: () => {} }));
vi.mock("../hooks/useDeliveryHealth", () => ({
  useDeliveryHealth: () => ({ state: "live", label: "Live", description: "ok", ageMs: null }),
}));

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  api.fetchHealth.mockReset();
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  Element.prototype.scrollTo = () => {};
});
afterEach(cleanup);

function mount() {
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute();
  const status = Route.update({ id: "/status", path: "/status", getParentRoute: () => rootRoute } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([status]),
    history: createMemoryHistory({ initialEntries: ["/status"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Status page", () => {
  it("core's own 500 body (no services) is 'could not read status' with a retry, not a crash", async () => {
    api.fetchHealth.mockResolvedValue({ status: "", error: "health check failed" });
    mount();
    expect(await screen.findByText("Could not read Scrollr's status")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    api.fetchHealth.mockResolvedValue({ status: "healthy", database: "healthy", redis: "healthy", services: {} });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("All systems normal")).toBeInTheDocument();
  });

  it("renders a 503 report and shows an unknown service state as text", async () => {
    api.fetchHealth.mockResolvedValue({
      status: "degraded", database: "healthy", redis: "healthy",
      services: { finance: "idle", sports: "healthy" },
    });
    mount();
    expect(await screen.findByText("Some services are degraded")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });
});
