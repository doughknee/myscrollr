/**
 * The website's ticker (SCROLLR-310): the real ticker bundle in a plain
 * page, fed by the anonymous public feed. embed.html loads this; it stands
 * in for Tauri (ticker-shim.html's bootstrap, production-clean), then
 * imports src/main.tsx exactly as the app's ticker window does.
 *
 * Query params:
 *   ?widgets=nfl,npr,stocks,github  catalog ids or short names (default: the
 *                                   sports widget with games tonight, then
 *                                   the starter, Stocks + NPR). The Clock is
 *                                   always on the edge.
 *   ?theme=<family>-<light|dark>    default: Scrollr, following the visitor's
 *                                   colour scheme
 *   ?mode=pages|continuous          default pages
 *   ?keypad=0|1                     the hover keypad (default 1)
 *   ?fixture=<name>                 src/dev/__fixtures__/dashboard.<name>.json,
 *                                   rebased to now, instead of the feed
 *
 * Data: GET api.myscrollr.com/public/feed, refreshed every 30 s, timestamps
 * as served; see feed.ts for what it lacks. If it fails or is empty, the
 * `default` fixture rebased to now. Clicks open the item in a new tab;
 * nothing is persisted, nothing is sent anywhere but the feed request.
 *
 * <html data-source="live|fixture:<name>" data-ready> once the bar has
 * drawn with data; the parent page also gets {scrollrBar: "ready", widgets}.
 */
import {
  STARTER,
  fromPublicFeed,
  isUtility,
  rebase,
  resolveWidget,
  sportsTonight,
  widgetRows,
} from "./feed";
import type { EmbedDashboard } from "./feed";

type Row = Record<string, unknown>;
type Args = Record<string, any>;

const FEED_URL = "https://api.myscrollr.com/public/feed";
const REFRESH_MS = 30_000;
const LABEL = "ticker";
const STORE_RID = 1;

const params = new URLSearchParams(location.search);
const forced = params.get("fixture");
const asked = params.has("widgets")
  ? params
      .get("widgets")!
      .split(",")
      .map((s) => resolveWidget(s.trim()))
      .filter((id): id is string => id !== null)
  : null;
const nativeFetch = window.fetch.bind(window);

// ── Data ───────────────────────────────────────────────────────────

const fixtures = import.meta.glob<Row>("../dev/__fixtures__/*.json", { import: "default" });

/** A bundled fixture, its timestamps shifted as if captured just now. */
async function fixture(name: string): Promise<Row | null> {
  const load = fixtures[`../dev/__fixtures__/${name}.json`];
  if (!load) return null;
  const j = await load();
  const captured = Date.parse(String(j._captured_at));
  return Number.isNaN(captured) ? j : rebase(j, Date.now() - captured);
}

/** News rows for when the public feed has none: the default fixture's, unlinked. */
async function newsRows(): Promise<Row[]> {
  const rss = ((await fixture("dashboard.default"))?.data as Row | undefined)?.rss as Row[] | undefined;
  return (rss ?? []).map((r) => ({ ...r, link: "" }));
}

async function live(): Promise<EmbedDashboard | null> {
  try {
    const res = await nativeFetch(FEED_URL);
    if (!res.ok) return null;
    const body = await res.json();
    const ids =
      asked ??
      [sportsTonight(body?.data?.sports?.sports ?? [], Date.now()), ...STARTER].filter(
        (id): id is string => id !== null,
      );
    return fromPublicFeed(body, ids, await newsRows());
  } catch {
    return null;
  }
}

async function fromFixture(name: string): Promise<EmbedDashboard> {
  const fx = ((await fixture(`dashboard.${name}`)) ?? (await fixture("dashboard.default"))) as unknown as EmbedDashboard;
  return asked ? { ...fx, widgets: widgetRows(asked) } : fx;
}

let source = forced ? `fixture:${forced}` : "live";
let current: Promise<EmbedDashboard> = forced
  ? fromFixture(forced)
  : live().then((d) => {
      if (d) return d;
      source = "fixture:default";
      return fromFixture("default");
    });

// ── Store (in memory; seeded, never saved) ─────────────────────────

// The Clock (the visitor's local time) is always on the edge.
const utils = ["clock", ...(asked?.filter((id) => isUtility(id) && id !== "clock") ?? (forced === "github" ? ["github"] : []))];
const theme = /^([a-z-]+)-(light|dark)$/.exec(params.get("theme") ?? "");
const store = new Map<string, unknown>([
  ["scrollr:store-migrated", true],
  // Looks signed in for a day so the ticker takes the /dashboard path,
  // which carries widget rows. No token ever leaves this page.
  ["scrollr:auth", { accessToken: "embed", refreshToken: null, expiresAt: Date.now() + 864e5, userSub: "embed" }],
  [
    "scrollr:settings",
    {
      appearance: theme ? { themeFamily: theme[1], themeMode: theme[2] } : undefined,
      ticker: {
        showTicker: true,
        scrollMode: params.get("mode") === "continuous" ? "continuous" : "pages",
        pageControls: params.get("keypad") !== "0",
      },
      widgets: { enabledWidgets: utils, widgetsOnTicker: utils, github: { repos: [] }, pins: [] },
    },
  ],
]);
// The GitHub page's sample repos and the config that tracks them (the public feed has no GitHub data, SCROLLR-312).
const seeded = utils.includes("github")
  ? fixture("github.board").then((j) => {
      store.set("scrollr:widget:github:board", j?.repos ?? []);
      const s = store.get("scrollr:settings") as { widgets: { github: { repos: unknown } } };
      s.widgets.github.repos = j?.config ?? [];
    })
  : Promise.resolve();

// ── Tauri stand-in ─────────────────────────────────────────────────

const callbacks = new Map<number, (e: unknown) => void>();
const listeners = new Map<number, { event: string; handler: number }>();
let nextId = 1;

function deliver(event: string, payload: unknown) {
  setTimeout(() => {
    for (const [id, l] of listeners) {
      if (l.event === event) callbacks.get(l.handler)?.({ event, id, payload });
    }
  });
}

async function reply(url: string): Promise<[number, unknown]> {
  if (/\/dashboard|\/public\/feed/.test(url)) return [200, await current];
  // The whole market (SCROLLR-292): what a short watchlist fills from.
  if (/\/finance\/public/.test(url)) return [200, (await current).data.finance ?? []];
  if (/\/catalog/.test(url)) return [200, { widgets: [] }];
  if (/\/health/.test(url)) return [200, { status: "healthy", database: "healthy", redis: "healthy", services: {} }];
  return [404, { error: "not in the embed" }];
}

const requests = new Map<number, string | Uint8Array | null>();

function openTab(url: unknown) {
  if (typeof url === "string" && /^https?:\/\//.test(url)) window.open(url, "_blank", "noopener");
}

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
    case "plugin:event|emit_to":
      return deliver(args.event, args.payload);

    case "plugin:store|load":
    case "plugin:store|get_store":
      return STORE_RID;
    case "plugin:store|entries":
      await seeded;
      return [...store.entries()];
    case "plugin:store|keys":
      return [...store.keys()];
    case "plugin:store|get": {
      const v = store.get(args.key);
      return [v ?? null, v !== undefined];
    }
    case "plugin:store|set":
      store.set(args.key, args.value);
      return;
    case "plugin:store|delete":
      return store.delete(args.key);
    case "plugin:store|save":
    case "plugin:store|reload":
      return;

    case "plugin:http|fetch": {
      const rid = nextId++;
      requests.set(rid, args.clientConfig.url);
      return rid;
    }
    case "plugin:http|fetch_send": {
      const url = requests.get(args.rid) as string;
      const [status, body] = await reply(url);
      requests.set(args.rid, new TextEncoder().encode(JSON.stringify(body)));
      return { status, statusText: "", url, headers: [["content-type", "application/json"]], rid: args.rid };
    }
    case "plugin:http|fetch_read_body": {
      const body = requests.get(args.rid);
      if (body instanceof Uint8Array) {
        requests.set(args.rid, null);
        const out = new Uint8Array(body.length + 1); // last byte 0 = more to come
        out.set(body);
        return out;
      }
      requests.delete(args.rid);
      return [1];
    }

    // A cell's link opens in a new tab instead of the system browser.
    case "plugin:shell|open":
      return openTab(args.path);
    case "open_external":
      return openTab(args.url);

    case "plugin:window|get_all_windows":
      return [LABEL];
  }
  // Window, tray, stream and webview commands: Rust's work in the app,
  // nothing to do in a page.
  return null;
}

const w = window as unknown as Record<string, unknown>;
w.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: LABEL },
    currentWebview: { label: LABEL, windowLabel: LABEL },
    windows: [{ label: LABEL }],
    webviews: [{ label: LABEL, windowLabel: LABEL }],
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

// The app's right-click menu is native; the page keeps the browser's own.
window.addEventListener("contextmenu", (e) => e.stopImmediatePropagation(), true);

// ── Refresh + ready ────────────────────────────────────────────────

if (!forced) {
  setInterval(() => {
    // The feed is ~400 KB uncompressed; a background tab doesn't need it.
    if (document.hidden) return;
    void live().then((d) => {
      if (!d) return; // keep what is on the bar
      source = "live";
      current = Promise.resolve(d);
      // What the main window's broadcast does in the app (App.tsx).
      deliver("store://change", { path: "scrollr.json", resourceId: STORE_RID, key: "scrollr:dashboard", value: d, exists: true });
    });
  }, REFRESH_MS);
}

void current.then((d) => {
  const root = document.getElementById("root")!;
  // The page around the bar shows which widgets are on it.
  const widgets = [...d.widgets.map((w) => w.widget_type), ...utils];
  const done = () => {
    setTimeout(() => {
      document.documentElement.dataset.source = source;
      document.documentElement.dataset.ready = "";
      window.parent.postMessage({ scrollrBar: "ready", widgets }, "*");
    }, 300);
  };
  if (root.childElementCount) return done();
  const mo = new MutationObserver(() => {
    if (!root.childElementCount) return;
    mo.disconnect();
    done();
  });
  mo.observe(root, { childList: true });
});

void import("../main");
