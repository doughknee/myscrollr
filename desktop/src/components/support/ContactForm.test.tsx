import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const authFetch = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../api/client", async (importActual) => ({
  ...(await importActual<typeof import("../../api/client")>()),
  authFetch: (...a: unknown[]) => authFetch(...a),
}));
vi.mock("../../auth", () => ({ getUserIdentity: () => ({}), isAuthenticated: () => true }));

import ContactForm from "./ContactForm";
import { ApiError } from "../../api/client";

function fill() {
  fireEvent.change(screen.getByPlaceholderText("Describe what you were doing..."), { target: { value: "Opened Home" } });
  fireEvent.change(screen.getByPlaceholderText("Describe the issue..."), { target: { value: "The bar froze" } });
}
const form = () => document.querySelector("form")!;

beforeEach(() => {
  invoke.mockReset();
  authFetch.mockReset();
  invoke.mockResolvedValue({ os: "windows" });
});

describe("ContactForm diagnostics summary (SCROLLR-423)", () => {
  it("promises diagnostics only when they were collected", async () => {
    render(<ContactForm onBack={() => {}} />);
    expect(await screen.findByText("System diagnostics will be included")).toBeInTheDocument();
  });

  it("says they could not be collected, and what is sent instead", async () => {
    invoke.mockRejectedValue(new Error("no"));
    render(<ContactForm onBack={() => {}} />);
    expect(await screen.findByText("System diagnostics could not be collected")).toBeInTheDocument();
    expect(screen.queryByText("System diagnostics will be included")).toBeNull();
    expect(screen.getByText("Your report will be sent without them.")).toBeInTheDocument();
    fill();
    authFetch.mockResolvedValue({});
    fireEvent.submit(form());
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(JSON.parse(authFetch.mock.calls[0][1].body).diagnostics).toBeUndefined();
  });
});

describe("ContactForm submit (RC-14)", () => {
  it("sends once however many times submit fires before the first answer", async () => {
    let done!: () => void;
    authFetch.mockReturnValue(new Promise<void>((r) => (done = r)));
    const onBack = vi.fn();
    render(<ContactForm onBack={onBack} />);
    await screen.findByText("System diagnostics will be included");
    fill();
    fireEvent.submit(form());
    fireEvent.submit(form());
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    fireEvent.submit(form());
    await new Promise((r) => setTimeout(r, 20));
    expect(authFetch).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the text and says the outcome is unknown when nothing came back", async () => {
    authFetch.mockRejectedValueOnce(new Error("aborted"));
    render(<ContactForm onBack={() => {}} />);
    await screen.findByText("System diagnostics will be included");
    fill();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("may have arrived");
    expect(screen.getByPlaceholderText("Describe the issue...")).toHaveValue("The bar froze");
    // Sending again after that is allowed, and clears the notice while it runs.
    authFetch.mockResolvedValueOnce({});
    fireEvent.submit(form());
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
  });

  it("says a refused send was not sent", async () => {
    authFetch.mockRejectedValueOnce(new ApiError(400, "bad"));
    render(<ContactForm onBack={() => {}} />);
    await screen.findByText("System diagnostics will be included");
    fill();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("wasn’t sent");
    expect(screen.getByPlaceholderText("Describe what you were doing...")).toHaveValue("Opened Home");
  });
});
