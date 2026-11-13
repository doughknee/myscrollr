import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const overview = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../SlotMeter", () => ({ slotHeadline: () => "", slotSubline: () => "", useSlotUsage: () => ({ used: 0 }) }));
vi.mock("../../../auth", async (importActual) => ({
  ...(await importActual<typeof import("../../../auth")>()),
  getUserIdentity: () => ({ email: null, name: null, username: null }),
}));
vi.mock("../../../api/queries", async (importActual) => ({
  ...(await importActual<typeof import("../../../api/queries")>()),
  userOverviewQueryOptions: () => ({ queryKey: ["user-overview"], queryFn: overview, retry: false }),
}));

import ProfilePlanPage from "./ProfilePlanPage";

const page = () => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ProfilePlanPage authenticated tier="free" subscriptionInfo={null} onLogin={() => {}} onLogout={() => {}} />
    </QueryClientProvider>,
  );
};

beforeEach(() => overview.mockReset());

// UD-10: a failed profile load used to leave empty editable fields with example placeholders.
describe("ProfilePlanPage when the profile does not load", () => {
  it("says so, offers Try again, and shows no placeholder identity", async () => {
    overview.mockRejectedValueOnce(new Error("500"));
    page();
    expect(await screen.findByText("Couldn’t load your profile")).toBeInTheDocument();
    expect(screen.queryByText("you@example.com")).toBeNull();
    expect(screen.queryByText("Add a display name")).toBeNull();

    overview.mockResolvedValueOnce({ identity: { name: "Ada", email: "ada@example.com", username: "ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("ada@example.com")).length).toBe(2);
    expect(screen.queryByText("Couldn’t load your profile")).toBeNull();
  });
});
