/**
 * fetchHealth must treat core's 503 as a REPORT, not a failure.
 *
 * Core returns 503 whenever any dependency is degraded (it doubles as
 * the k8s readiness probe) but the body still names what's down. The
 * status page's whole reason to exist is that case, so routing it
 * through the throwing `request()` helper made a degraded backend
 * render as "Can't reach Scrollr" — caught live by stopping the
 * finance service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const { fetchHealth } = await import("./client");

const DEGRADED_BODY = {
  status: "degraded",
  database: "healthy",
  redis: "healthy",
  services: { finance: "down", sports: "healthy" },
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("fetchHealth", () => {
  it("returns the report when core answers 503 (degraded)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => DEGRADED_BODY,
    });

    const health = await fetchHealth();
    expect(health.status).toBe("degraded");
    expect(health.services.finance).toBe("down");
  });

  it("returns the report when core answers 200 (healthy)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...DEGRADED_BODY, status: "healthy", services: {} }),
    });

    const health = await fetchHealth();
    expect(health.status).toBe("healthy");
  });

  it("throws when core is genuinely unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(fetchHealth()).rejects.toThrow();
  });
});
