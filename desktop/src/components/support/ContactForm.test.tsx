import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const authFetch = vi.fn();
const publicRequest = vi.fn();
const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../api/client", async (importActual) => ({
  ...(await importActual<typeof import("../../api/client")>()),
  authFetch: (...a: unknown[]) => authFetch(...a),
  request: (...a: unknown[]) => publicRequest(...a),
}));
vi.mock("../../auth", () => ({ getUserIdentity: () => ({}), isSignedOut: () => !session.signedIn }));

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
  publicRequest.mockReset();
  session.signedIn = true;
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

describe("ContactForm signed out (D3-1)", () => {
  it("sends to the public route with the email, never through the signed-in one", async () => {
    session.signedIn = false;
    publicRequest.mockResolvedValue({});
    render(<ContactForm onBack={() => {}} />);
    fireEvent.click(screen.getByText("Account & Login"));
    const text = screen.getByLabelText("Describe your account issue");
    fireEvent.change(text, { target: { value: "I cannot sign in at all" } });
    expect(screen.getByText("Submit Account Question")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "me@example.com" } });
    fireEvent.submit(form());
    await waitFor(() => expect(publicRequest).toHaveBeenCalledTimes(1));
    expect(authFetch).not.toHaveBeenCalled();
    const [path, init] = publicRequest.mock.calls[0];
    expect(path).toBe("/support/ticket/public");
    expect(JSON.parse(init.body)).toMatchObject({ email: "me@example.com", category: "feedback" });
    expect(JSON.parse(init.body).message).toContain("Account & Login");
  });

  it("keeps a user with a stored session on the signed-in route (D4-1)", async () => {
    session.signedIn = true;
    authFetch.mockResolvedValue({});
    render(<ContactForm onBack={() => {}} />);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    fill();
    fireEvent.submit(form());
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(publicRequest).not.toHaveBeenCalled();
  });

  it("measures the public limits in bytes (D4-2)", async () => {
    session.signedIn = false;
    publicRequest.mockResolvedValue({});
    render(<ContactForm onBack={() => {}} />);
    fireEvent.click(screen.getByText("Account & Login"));
    fireEvent.change(screen.getByLabelText("Describe your account issue"), { target: { value: "я".repeat(120) } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "me@example.com" } });
    fireEvent.submit(form());
    await waitFor(() => expect(publicRequest).toHaveBeenCalledTimes(1));
    const subject = JSON.parse(publicRequest.mock.calls[0][1].body).subject as string;
    expect(new TextEncoder().encode(subject).length).toBeLessThanOrEqual(200);
    fireEvent.change(screen.getByLabelText("Describe your account issue"), { target: { value: "я".repeat(2600) } });
    expect(screen.getByText(/too long to send without signing in/)).toBeInTheDocument();
  });

  it("does not offer attachments or diagnostics it cannot send", () => {
    session.signedIn = false;
    render(<ContactForm onBack={() => {}} />);
    expect(screen.queryByText("Attach files")).toBeNull();
    expect(screen.getByText(/only sent when you are signed in/)).toBeInTheDocument();
  });
});

describe("ContactForm attachments (D3-2, D3-16)", () => {
  const pick = (...sizes: number[]) =>
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: sizes.map((n, i) => new File([new Uint8Array(n)], `shot${i}.png`, { type: "image/png" })) },
    });

  it("refuses a file that would pass the total limit and names the limit", async () => {
    render(<ContactForm onBack={() => {}} />);
    pick(1.5 * 1024 * 1024);
    expect(screen.getByText(/Attached: 1.5 MB of 2.5 MB/)).toBeInTheDocument();
    pick(1.5 * 1024 * 1024);
    expect(await screen.findByRole("alert")).toHaveTextContent("limit is 2.5 MB in total");
    expect(document.querySelectorAll("[aria-label^='Remove']")).toHaveLength(1);
  });

  it("says plainly what a 413 means", async () => {
    authFetch.mockRejectedValueOnce(new ApiError(413, "Request failed"));
    render(<ContactForm onBack={() => {}} />);
    fill();
    fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
  });

  it("ties labels to fields and marks the chosen chip", () => {
    render(<ContactForm onBack={() => {}} />);
    expect(screen.getByLabelText("What went wrong?")).toBeInstanceOf(HTMLTextAreaElement);
    fireEvent.click(screen.getByText("Sometimes"));
    expect(screen.getByText("Sometimes")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Always")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Bug Report")).toHaveAttribute("aria-pressed", "true");
  });
});
