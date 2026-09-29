import { LazyStore } from "@tauri-apps/plugin-store";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { API_BASE, REDIRECT_URI } from "../config";
import { installWebAdapter, WEB_REDIRECT_URI } from "./web";

// The real plugin JS runs against the adapter, so this is the wire contract.
describe("web mode adapter", () => {
  const seen: { url: string; body: string }[] = [];

  beforeAll(() => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body ?? "") });
      return new Response('{"ok":true}', { status: 200 });
    });
    installWebAdapter("main");
  });

  it("stores in localStorage and tells the writer, like the Rust store", async () => {
    const store = new LazyStore("scrollr.json");
    const changes: unknown[] = [];
    await store.onKeyChange("scrollr:x", (v) => changes.push(v));
    await store.set("scrollr:x", { a: 1 });
    expect(await store.get("scrollr:x")).toEqual({ a: 1 });
    expect(localStorage.getItem("tauri-store:scrollr.json:scrollr:x")).toBe('{"a":1}');
    await new Promise((r) => setTimeout(r, 0));
    expect(changes).toEqual([{ a: 1 }]);
  });

  it("hears the other window's write through the storage event", async () => {
    const store = new LazyStore("scrollr.json");
    const changes: unknown[] = [];
    await store.onKeyChange("scrollr:y", (v) => changes.push(v));
    window.dispatchEvent(new StorageEvent("storage", { key: "tauri-store:scrollr.json:scrollr:y", newValue: "2" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(changes).toEqual([2]);
  });

  it("proxies API calls and swaps the redirect in the code exchange", async () => {
    const res = await tauriFetch(`${API_BASE}/extension/token`, {
      method: "POST",
      body: JSON.stringify({ code: "c", redirect_uri: REDIRECT_URI, code_verifier: "v" }),
    });
    expect(await res.json()).toEqual({ ok: true });
    const last = seen.at(-1)!;
    expect(last.url).toBe("/__api/extension/token");
    expect(JSON.parse(last.body).redirect_uri).toBe(WEB_REDIRECT_URI);
  });
});
