/**
 * The writes behind a widget's controls (SCROLLR-473): they keep their order,
 * a failure undoes only itself, removing a widget takes its pins along, and a
 * failed toggle from the ticker reaches the user.
 */
import { createContext } from "react";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../api/queries";
import type { DashboardResponse } from "../types";
import { loadPrefs } from "../preferences";
import type { AppPreferences } from "../preferences";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  del: vi.fn(),
  emit: vi.fn(async () => {}),
  invoke: vi.fn(async () => {}),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
  shell: { prefs: null as unknown as AppPreferences, onPrefsChange: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tauri-apps/api/event", () => ({ emit: h.emit, listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../shell-context", async () => ({
  useShell: () => h.shell,
  useShellData: () => ({ widgets: [] }),
  ShellContext: createContext(null),
}));
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  dataWidgetsApi: { update: h.update, create: h.create, delete: h.del },
  toggleDataWidgetVisibility: (...a: unknown[]) => h.update(...a),
}));

const { useDataWidgetConfig } = await import("./useDataWidgetConfig");
const { useAddWidget } = await import("./useAddWidget");
const { useRemoveWidget } = await import("./useRemoveWidget");
const { useToggleOnTicker } = await import("./useToggleOnTicker");
const { ApiError } = await import("../api/client");

const row = (widget_type: string, config: Record<string, unknown> = {}) => ({
  id: widget_type.length,
  widget_type,
  enabled: true,
  ticker_enabled: true,
  config,
  created_at: "",
  updated_at: "",
});
const dash = (...widgets: ReturnType<typeof row>[]) => ({ data: {}, widgets }) as unknown as DashboardResponse;

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const widgetsIn = () => qc.getQueryData<DashboardResponse>(queryKeys.dashboard)?.widgets ?? [];
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  h.shell.prefs = loadPrefs();
});

describe("config writes (D2-15)", () => {
  it("one widget's writes run in click order, and a failure keeps the change queued behind it", async () => {
    qc.setQueryData(queryKeys.dashboard, dash(row("finance", { symbols: [] })));
    const first = deferred();
    h.update.mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDataWidgetConfig<string[]>("finance", "symbols"), { wrapper });

    act(() => result.current.updateItems(["A"]));
    act(() => result.current.updateItems(["A", "B"]));
    await waitFor(() => expect((widgetsIn()[0].config as { symbols: string[] }).symbols).toEqual(["A", "B"]));
    // The second write has not started: it waits its turn.
    expect(h.update).toHaveBeenCalledTimes(1);

    first.reject(new Error("refused"));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(2));
    // The first failure did not roll the cache back over the second change.
    expect((widgetsIn()[0].config as { symbols: string[] }).symbols).toEqual(["A", "B"]);
  });
});

describe("adding a widget (D2-15)", () => {
  const item = (id: string, source?: string) => ({ id, name: id, source, addConfig: {} }) as never;

  it("a failed add removes only its own placeholder, even from an empty cache", async () => {
    const a = deferred();
    h.create.mockReturnValueOnce(a.promise).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAddWidget(), { wrapper });
    await act(async () => {
      await result.current(item("finance", "finance"));
      await new Promise((r) => setTimeout(r, 2)); // placeholder ids come from the clock
      await result.current(item("rss_npr", "rss"));
    });
    expect(widgetsIn().map((w) => w.widget_type)).toEqual(["finance", "rss_npr"]);
    await act(async () => a.reject(new Error("refused")));
    expect(widgetsIn().map((w) => w.widget_type)).toEqual(["rss_npr"]);

    qc.removeQueries();
    h.create.mockReset().mockRejectedValue(new Error("refused"));
    await act(async () => void (await result.current(item("finance", "finance"))));
    await waitFor(() => expect(widgetsIn()).toEqual([]));
  });

  it("a utility already on the bar is not added twice", async () => {
    h.shell.prefs = {
      ...h.shell.prefs,
      widgets: { ...h.shell.prefs.widgets, enabledWidgets: ["clock"], widgetsOnTicker: ["clock"] },
    };
    const { result } = renderHook(() => useAddWidget(), { wrapper });
    await act(async () => void (await result.current(item("clock"))));
    const next = h.shell.onPrefsChange.mock.calls[0][0] as AppPreferences;
    expect(next.widgets.enabledWidgets).toEqual(["clock"]);
    expect(next.widgets.widgetsOnTicker).toEqual(["clock"]);
  });
});

describe("removing a widget (D2-14)", () => {
  it("drops its pins, and Undo puts them back", async () => {
    const pins = [
      { widget: "finance", subject: "AAPL" },
      { widget: "sports_nfl", subject: "42" },
    ];
    const prefs = { ...h.shell.prefs, widgets: { ...h.shell.prefs.widgets, pins } } as AppPreferences;
    qc.setQueryData(queryKeys.dashboard, dash(row("finance")));
    h.del.mockResolvedValue(undefined);
    h.create.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRemoveWidget({ prefs, onPrefsChange: h.shell.onPrefsChange }), {
      wrapper,
    });
    await act(async () => result.current({ id: "finance", name: "Stocks", source: "finance" } as never));
    expect((h.shell.onPrefsChange.mock.calls[0][0] as AppPreferences).widgets.pins).toEqual([pins[1]]);

    const undo = h.toast.success.mock.calls[0][1].action.onClick as () => void;
    await act(async () => undo());
    await waitFor(() => expect(h.shell.onPrefsChange).toHaveBeenCalledTimes(2));
    expect((h.shell.onPrefsChange.mock.calls[1][0] as AppPreferences).widgets.pins).toEqual([pins[1], pins[0]]);
  });
});

describe("toggling from the bar (D2-16)", () => {
  const setup = (onError?: () => void) =>
    renderHook(() => useToggleOnTicker({ getPrefs: () => h.shell.prefs, persistPrefs: vi.fn(), onError }), {
      wrapper,
    });

  it("a refusal restores the chip and tells the main window, which can toast it", async () => {
    qc.setQueryData(queryKeys.dashboard, dash(row("finance")));
    h.update.mockRejectedValue(new ApiError(403, "plan"));
    const { result } = setup();
    await act(async () => result.current("finance"));
    expect(widgetsIn()[0].ticker_enabled).toBe(true);
    expect(h.emit).toHaveBeenCalledWith("widget-toggle-failed", {
      widgetId: "finance",
      on: false,
      status: 403,
      message: "plan",
    });
    expect(h.invoke).toHaveBeenCalledWith("show_app_window");
  });

  it("the main window handles it itself and does not forward", async () => {
    qc.setQueryData(queryKeys.dashboard, dash(row("finance")));
    h.update.mockRejectedValue(new Error("x"));
    const onError = vi.fn();
    const { result } = setup(onError);
    await act(async () => result.current("finance"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("cancels an in-flight dashboard fetch before the optimistic write", async () => {
    qc.setQueryData(queryKeys.dashboard, dash(row("finance")));
    const cancel = vi.spyOn(qc, "cancelQueries");
    h.update.mockResolvedValue(undefined);
    const { result } = setup();
    await act(async () => result.current("finance"));
    expect(cancel).toHaveBeenCalledWith({ queryKey: queryKeys.dashboard });
  });
});
