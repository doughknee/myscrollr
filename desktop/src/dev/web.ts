/**
 * Web mode (SCROLLR-250): the browser stand-in for Tauri's Rust half.
 *
 * `desktop/web.html` puts the real ticker and the real main window in two
 * same-origin iframes and calls `installWebAdapter(label)` in each before
 * the entry bundle loads. Each iframe is its own JS realm, exactly like
 * each Tauri webview, so App.tsx still runs once per window and every
 * cross-window rule (`onStoreChange`, one SSE owner via windowRole.ts)
 * applies as it does in the app. Nothing here is imported by a build entry
 * (index/app/identify.html), and the guard below refuses to run outside
 * `vite dev`, so a release never contains it.
 *
 * What stands in for what:
 *   plugin-store   localStorage under `tauri-store:<path>:<key>`; the other
 *                  window hears a write through the `storage` event, the
 *                  writer hears its own (Rust emits to every webview).
 *   plugin-http    the browser's fetch; API calls go through the dev
 *                  server's `/__api` proxy (the API sends no CORS headers
 *                  for localhost). Other hosts are fetched directly and
 *                  can fail on CORS where the app would not.
 *   start_sse      a fetch stream in whichever window calls it (only the
 *                  owner does), frames re-emitted to both windows as
 *                  `sse-event` / `sse-status`. A fetch, not EventSource,
 *                  because it carries the Bearer header and sees the 401
 *                  that must become `auth-expired`, as sse.rs does.
 *   auth server    Logto redirects to `<origin>/callback` (the dev server
 *                  serves web.html there), which broadcasts `auth-callback`
 *                  to both windows and closes. The PKCE verifier and state
 *                  never leave auth.ts. The fixed 127.0.0.1:19284 redirect
 *                  is swapped for that URL in the two places it travels:
 *                  the authorize URL (open_external) and the code exchange.
 *   events         in-window listener table + a BroadcastChannel to the
 *                  other window; `emit_to` delivers only to its label.
 *   window, tray,  logged no-ops. Position/visibility of the bar are
 *   monitors ...   forwarded to the page so it can size the ticker frame.
 */
import { API_BASE, REDIRECT_URI } from "../config";

type Args = Record<string, any>;
type Label = "ticker" | "main";

const WINDOWS: Label[] = ["ticker", "main"];
const CHANNEL = "scrollr-web";
const STORE_PREFIX = "tauri-store:";
const API_PROXY = "/__api";

/** The redirect Logto knows for web mode; the dev server serves it. */
export const WEB_REDIRECT_URI = `${location.origin}/callback`;

/** Run on the /callback page: hand Logto's answer to the waiting window. */
export function relayAuthCallback(): void {
  const q = new URLSearchParams(location.search);
  const payload = {
    code: q.get("code"),
    state: q.get("state"),
    error: q.get("error"),
    error_description: q.get("error_description"),
  };
  new BroadcastChannel(CHANNEL).postMessage({ event: "auth-callback", payload });
  document.body.textContent = payload.code
    ? "Signed in. You can close this tab."
    : `Sign-in failed: ${payload.error_description ?? payload.error ?? "no code"}`;
  window.close();
}

export function installWebAdapter(label: Label): void {
  if (!import.meta.env.DEV) throw new Error("web mode is dev-only");

  const log = (...a: unknown[]) => console.debug(`[web:${label}]`, ...a);
  const nativeFetch = window.fetch.bind(window);
  const bus = new BroadcastChannel(CHANNEL);
  const toPage = (msg: Record<string, unknown>) =>
    window.parent.postMessage({ scrollrWeb: label, ...msg }, location.origin);
  let nextId = 1;

  // ── Events ────────────────────────────────────────────────────────
  const callbacks = new Map<number, (e: unknown) => void>();
  const listeners = new Map<number, { event: string; handler: number }>();

  // Async, as over IPC: a handler never runs inside the invoke that caused it.
  const deliver = (event: string, payload: unknown) =>
    setTimeout(() => {
      for (const [id, l] of listeners) {
        if (l.event === event) callbacks.get(l.handler)?.({ event, id, payload });
      }
    });
  /** Rust's app.emit (every window) or emit_to(target). */
  const emit = (event: string, payload: unknown, target?: string) => {
    if (!target || target === label) deliver(event, payload);
    bus.postMessage({ event, payload, target });
  };

  // ── Store ─────────────────────────────────────────────────────────
  const rids = new Map<number, string>(); // rid → path
  const ridOf = new Map<string, number>(); // path → rid
  const full = (rid: number, key: string) => `${STORE_PREFIX}${rids.get(rid)}:${key}`;
  const parse = (raw: string | null) => (raw === null ? undefined : JSON.parse(raw));
  const entries = (rid: number) => {
    const p = `${STORE_PREFIX}${rids.get(rid)}:`;
    const out: [string, unknown][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(p)) out.push([k.slice(p.length), parse(localStorage.getItem(k))]);
    }
    return out;
  };
  const storeChanged = (path: string, key: string, value: unknown) => {
    const rid = ridOf.get(path);
    if (rid !== undefined) {
      deliver("store://change", { path, resourceId: rid, key, value, exists: value !== undefined });
    }
  };
  // Fires in every OTHER same-origin document: the other window's writes.
  window.addEventListener("storage", (e) => {
    if (!e.key?.startsWith(STORE_PREFIX)) return;
    const rest = e.key.slice(STORE_PREFIX.length);
    const at = rest.indexOf(":");
    storeChanged(rest.slice(0, at), rest.slice(at + 1), parse(e.newValue));
  });

  // ── HTTP ──────────────────────────────────────────────────────────
  interface Req { config: Args; abort: AbortController; reader?: ReadableStreamDefaultReader<Uint8Array> }
  const reqs = new Map<number, Req>();
  const viaProxy = (url: string) =>
    url.startsWith(API_BASE) ? API_PROXY + url.slice(API_BASE.length) : url;

  async function send(rid: number) {
    const r = reqs.get(rid)!;
    const { method, url, headers, data } = r.config;
    let body: Uint8Array | string | undefined = data ? new Uint8Array(data) : undefined;
    if (body && /\/extension\/token$/.test(url)) {
      const j = JSON.parse(new TextDecoder().decode(body));
      if (j.redirect_uri === REDIRECT_URI) j.redirect_uri = WEB_REDIRECT_URI;
      body = JSON.stringify(j);
    }
    const res = await nativeFetch(viaProxy(url), {
      method,
      headers,
      body: body as BodyInit | undefined,
      signal: r.abort.signal,
    });
    r.reader = res.body?.getReader();
    return { status: res.status, statusText: res.statusText, url, headers: [...res.headers], rid };
  }

  async function readBody(rid: number) {
    const chunk = await reqs.get(rid)?.reader?.read();
    if (!chunk || chunk.done) {
      reqs.delete(rid);
      return [1];
    }
    const out = new Uint8Array(chunk.value.length + 1); // last byte 0 = more to come
    out.set(chunk.value);
    return out;
  }

  // ── SSE (one stream across both windows, like the Rust SseHandle) ──
  let sse: AbortController | null = null;
  const killSse = () => {
    sse?.abort();
    sse = null;
  };

  async function runSse(token: string, ctl: AbortController) {
    let backoff = 1;
    while (!ctl.signal.aborted) {
      try {
        const res = await nativeFetch(`${API_PROXY}/events`, {
          headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
          signal: ctl.signal,
        });
        if (res.status === 401) {
          emit("sse-status", { status: "auth-expired" });
          return;
        }
        if (!res.ok || !res.body) {
          emit("sse-status", { status: "error", code: res.status });
        } else {
          emit("sse-status", { status: "connected" });
          backoff = 1;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += value;
            let at: number;
            while ((at = buf.indexOf("\n\n")) >= 0) {
              const frame = buf.slice(0, at);
              buf = buf.slice(at + 2);
              for (const line of frame.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                try {
                  emit("sse-event", JSON.parse(line.slice(6)));
                } catch {
                  // not JSON: sse.rs drops these too
                }
              }
            }
          }
        }
      } catch (err) {
        if (ctl.signal.aborted) return;
        emit("sse-status", { status: "disconnected", error: String(err) });
      }
      if (ctl.signal.aborted) return;
      emit("sse-status", { status: "reconnecting" });
      await new Promise((r) => setTimeout(r, backoff * 1000));
      backoff = Math.min(backoff * 2, 30);
    }
  }

  bus.onmessage = ({ data }) => {
    if (data.killSse) return killSse();
    if (!data.target || data.target === label) deliver(data.event, data.payload);
  };

  // ── invoke ────────────────────────────────────────────────────────
  const noop = new Set([
    "position_ticker", "pin_window", "sync_ticker_windows", "set_ticker_visible",
    "show_app_window", "identify_monitors", "sync_tray_ticker", "set_hide_on_fullscreen",
    "quit_app", "configure_presence", "report_screen_state", "set_crash_reports",
    "start_auth_server", "stop_auth_server",
  ]);

  async function invoke(cmd: string, args: Args = {}): Promise<unknown> {
    switch (cmd) {
      case "plugin:event|listen": {
        const id = nextId++;
        listeners.set(id, { event: args.event, handler: args.handler });
        return id;
      }
      case "plugin:event|unlisten":
        listeners.delete(args.eventId);
        return;
      case "plugin:event|emit":
        return emit(args.event, args.payload);
      case "plugin:event|emit_to":
        return emit(args.event, args.payload, args.target?.label);

      case "plugin:store|load":
      case "plugin:store|get_store": {
        let rid = ridOf.get(args.path);
        if (rid === undefined) {
          rid = nextId++;
          ridOf.set(args.path, rid);
          rids.set(rid, args.path);
        }
        return rid;
      }
      case "plugin:store|get": {
        const v = parse(localStorage.getItem(full(args.rid, args.key)));
        return [v ?? null, v !== undefined];
      }
      case "plugin:store|has":
        return localStorage.getItem(full(args.rid, args.key)) !== null;
      case "plugin:store|set":
        localStorage.setItem(full(args.rid, args.key), JSON.stringify(args.value ?? null));
        return storeChanged(rids.get(args.rid)!, args.key, args.value);
      case "plugin:store|delete": {
        const k = full(args.rid, args.key);
        const had = localStorage.getItem(k) !== null;
        localStorage.removeItem(k);
        storeChanged(rids.get(args.rid)!, args.key, undefined);
        return had;
      }
      case "plugin:store|entries":
        return entries(args.rid);
      case "plugin:store|keys":
        return entries(args.rid).map(([k]) => k);
      case "plugin:store|values":
        return entries(args.rid).map(([, v]) => v);
      case "plugin:store|length":
        return entries(args.rid).length;
      case "plugin:store|save":
      case "plugin:store|reload":
        return; // localStorage is already durable

      case "plugin:http|fetch": {
        const rid = nextId++;
        reqs.set(rid, { config: args.clientConfig, abort: new AbortController() });
        return rid;
      }
      case "plugin:http|fetch_send":
        return send(args.rid);
      case "plugin:http|fetch_read_body":
        return readBody(args.rid);
      case "plugin:http|fetch_cancel":
      case "plugin:http|fetch_cancel_body":
        reqs.get(args.rid)?.abort.abort();
        reqs.delete(args.rid);
        return;

      case "start_sse": {
        bus.postMessage({ killSse: true }); // Rust cancels any running task
        killSse();
        const ctl = new AbortController();
        sse = ctl;
        void runSse(args.token, ctl);
        return;
      }
      case "stop_sse":
        bus.postMessage({ killSse: true });
        killSse();
        return emit("sse-status", { status: "disconnected" });

      case "open_external":
      case "plugin:shell|open": {
        const url = new URL(args.url ?? args.path);
        if (url.searchParams.get("redirect_uri") === REDIRECT_URI) {
          url.searchParams.set("redirect_uri", WEB_REDIRECT_URI);
        }
        // Logto's page finishes on /callback in that tab, which relays to us.
        if (!window.open(url, "_blank")) {
          console.warn(`[web:${label}] popup blocked; allow popups for ${location.origin} or open:`, url.href);
        }
        return;
      }

      case "get_system_info":
        return { cpu_usage: 12, memory_used: 8e9, memory_total: 32e9, disk_used: 2e11, disk_total: 1e12 };
      case "list_monitors": {
        const { width, height } = window.screen;
        const scaleFactor = window.devicePixelRatio;
        return [{
          name: "Browser", x: 0, y: 0, width, height, scaleFactor, isPrimary: true,
          physicalX: 0, physicalY: 0,
          physicalWidth: Math.round(width * scaleFactor), physicalHeight: Math.round(height * scaleFactor),
        }];
      }

      case "plugin:window|get_all_windows":
        return WINDOWS;
      case "plugin:window|is_visible":
        return true;
      case "plugin:menu|new": {
        const rid = nextId++;
        return [rid, `web-menu-${rid}`];
      }
      case "plugin:app|version":
        return __APP_VERSION__;
      case "plugin:app|name":
        return "Scrollr";
      case "plugin:updater|check":
        return null; // no update
      case "plugin:autostart|is_enabled":
        return false;
    }

    if (cmd === "position_ticker") toPage({ height: args.height, position: args.position });
    if (cmd === "set_ticker_visible") toPage({ visible: args.visible });
    if (
      noop.has(cmd) ||
      /^plugin:(window|webview|menu|resources|process|autostart)\|/.test(cmd)
    ) {
      log(cmd, args);
      return null;
    }
    console.warn(`[web:${label}] no web stand-in for ${cmd}`, args);
    throw `web mode: no handler for ${cmd}`;
  }

  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label },
      currentWebview: { label, windowLabel: label },
      windows: WINDOWS.map((l) => ({ label: l })),
      webviews: WINDOWS.map((l) => ({ label: l, windowLabel: l })),
    },
    invoke,
    transformCallback(cb: (e: unknown) => void, once = false) {
      const id = nextId++;
      callbacks.set(id, once ? (e) => { callbacks.delete(id); cb(e); } : cb);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (p: string) => p,
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, id: number) => listeners.delete(id),
  };
}
