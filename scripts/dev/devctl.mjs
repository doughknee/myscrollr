#!/usr/bin/env node
// Run JavaScript inside a running dev build's window and print the result.
//
//   node scripts/dev/devctl.mjs ticker 'document.title'
//   node scripts/dev/devctl.mjs main   'router.navigate({ to: "/catalog" })'
//   node scripts/dev/devctl.mjs ticker 'savePrefs({ ...prefs(), appearance: { ...prefs().appearance, themeMode: "light" } })'
//   node scripts/dev/devctl.mjs ticker --file scripts/dev/some-scenario.js
//
// The code runs in the window with `ctx` spread into scope (see
// desktop/src/dev/bus.ts for what is in it: prefs(), savePrefs, qc, invoke,
// text(), rect(), and router in the main window). An expression is
// returned as-is; a body may `return`. Await is available.
//
// Dev builds only: the bus is a Vite middleware and the poller is behind
// import.meta.env.DEV, so there is nothing to talk to in a release build.
import { readFileSync } from "node:fs";

const [win, ...rest] = process.argv.slice(2);
if (!win || rest.length === 0) {
  console.error("usage: devctl.mjs <ticker|main> '<code>' | --file <path> [--timeout ms]");
  process.exit(2);
}
let code = rest[0] === "--file" ? readFileSync(rest[1], "utf8") : rest[0];
const t = rest.indexOf("--timeout");
const timeout = t >= 0 ? Number(rest[t + 1]) : 8000;
const base = process.env.SCROLLR_DEV_URL ?? "http://localhost:5174";

const res = await fetch(`${base}/__dev/cmd`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ window: win, code, timeout }),
});
const body = await res.json().catch(() => ({ ok: false, error: `bad response ${res.status}` }));
if (!body.ok) {
  console.error(`[devctl] ${body.error}`);
  process.exit(1);
}
console.log(typeof body.value === "string" ? body.value : JSON.stringify(body.value, null, 2));
