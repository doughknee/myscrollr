/** "Use my location" reaches an https lookup through the app's http plugin (CN-7). */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn(), saved: [] as unknown[] }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: h.fetch }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../../shell-context", () => ({
  useShell: () => ({ prefs: { appearance: { units: { temperature: "f" } } } }),
}));
vi.mock("../../api/queries", async (orig) => ({
  ...(await orig<typeof import("../../api/queries")>()),
  weatherQueryOptions: () => ({ queryKey: ["weather-test"], queryFn: async () => [] }),
}));
vi.mock("./types", async (orig) => ({
  ...(await orig<typeof import("./types")>()),
  loadCities: () => [],
  saveCities: (c: unknown[]) => void h.saved.push(...c),
}));

// The screen is the module default; its manifest lazy-loads it (SCROLLR-408).
const Feed = (await import("./FeedTab")).default as (p: { mode: string }) => import("react").ReactElement;

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.clearAllMocks();
  h.saved.length = 0;
});

it("asks an https geolocation host, through plugin-http, and adds the city it names", async () => {
  h.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, city: "Austin", latitude: 30.27, longitude: -97.74, country: "United States", region: "Texas" }),
  });
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Feed mode="comfort" />
    </QueryClientProvider>,
  );
  fireEvent.click(document.querySelector("svg.lucide-locate-fixed")!.closest("button")!);
  await waitFor(() => expect(h.saved).toHaveLength(1));
  expect(String(h.fetch.mock.calls[0][0])).toMatch(/^https:\/\//);
  expect(h.saved[0]).toMatchObject({ location: { name: "Austin", lat: 30.27, lon: -97.74, admin1: "Texas" } });
  expect(screen.queryByText(/Couldn't detect/)).toBeNull();
});
