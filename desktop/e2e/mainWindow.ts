import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The real main window in web mode (`web.html?window=main`) with the API
 * answered by the test: signed in, empty store, everything else a 404 unless
 * the case says otherwise. Nothing leaves localhost.
 */
const STORE = "tauri-store:scrollr.json:";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "none" })}.${b64({ sub: "logto|t", roles: [], exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), `src/dev/__fixtures__/dashboard.${name}.json`), "utf8"));
const catalog = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/catalog.snapshot.json"), "utf8"));

export interface Forced { status: number; body?: unknown; delay?: number }
export interface MainCase {
  dashboard?: unknown;
  /** Answer one API path (after `/__api`) yourself; return null to use the default. */
  api?: (path: string, method: string) => Forced | null;
  /** Extra store keys, e.g. a saved dashboard. */
  store?: Record<string, unknown>;
  scheme?: "dark" | "light";
}

export async function openMain(page: Page, context: BrowserContext, c: MainCase = {}) {
  const scheme = c.scheme ?? "dark";
  const seed = {
    "scrollr:store-migrated": true,
    "scrollr:settings": { appearance: { themeFamily: "scrollr", themeMode: scheme } },
    "scrollr:auth": { accessToken: jwt(), refreshToken: "r", expiresAt: Date.now() + 864e5, userSub: "logto|t" },
    ...(c.store ?? {}),
  };
  await context.addInitScript(({ seed, STORE, scheme }) => {
    if (localStorage.getItem("__seeded")) return;
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(STORE + k, JSON.stringify(v));
    localStorage.setItem("scrollr:theme-mirror", JSON.stringify({ family: "scrollr", mode: scheme }));
    localStorage.setItem("__seeded", "1");
  }, { seed, STORE, scheme });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== "localhost") {
      if (req.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return route.abort("blockedbyclient");
    }
    if (!u.pathname.startsWith("/__api/")) return u.pathname.startsWith("/fake-logto") ? route.fulfill({ status: 200, body: "x" }) : route.continue();
    const p = u.pathname.slice(6);
    if (p.startsWith("/events")) return route.abort("failed");
    const forced = c.api?.(p, req.method());
    if (forced) {
      if (forced.delay) await new Promise((r) => setTimeout(r, forced.delay));
      return route.fulfill({ status: forced.status, contentType: "application/json", body: JSON.stringify(forced.body ?? { error: "forced" }) });
    }
    const dash = (c.dashboard ?? fixture("empty")) as { data?: { sports?: unknown[]; sports_meta?: unknown } };
    const body =
      p === "/dashboard" ? dash :
      p === "/public/feed" ? { data: dash.data } :
      p === "/catalog" ? catalog() :
      p === "/app/min-version" ? { min_desktop_version: "1.0.0" } :
      p === "/users/me/subscription" ? { plan: "free", status: "none" } :
      p === "/users/me/posthog-analytics" ? { decision: "declined" } :
      p === "/users/me/widgets/starter" ? { applied: false, widgets: [] } :
      p === "/sports" ? { sports: dash.data?.sports ?? [], meta: dash.data?.sports_meta ?? { leagues: [] } } :
      p === "/finance/public" ? [] : null;
    return route.fulfill({ status: body ? 200 : 404, contentType: "application/json", body: JSON.stringify(body ?? { error: "not stubbed" }) });
  });
  await page.goto("/web.html?window=main");
}
