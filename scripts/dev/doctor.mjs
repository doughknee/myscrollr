#!/usr/bin/env node
/**
 * `make doctor` — check that this machine can actually run the stack.
 *
 * Every check names the fix, because "Docker isn't running" is only useful
 * if you're told what to do about it. Run with --quiet to print nothing
 * unless something is wrong (that's how `make up` calls it).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const QUIET = process.argv.includes("--quiet");

const results = [];
const ok = (name, detail = "") => results.push({ level: "ok", name, detail });
const warn = (name, detail, fix) => results.push({ level: "warn", name, detail, fix });
const fail = (name, detail, fix) => results.push({ level: "fail", name, detail, fix });

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// ── Tooling ──────────────────────────────────────────────────────────
const docker = sh("docker --version");
if (!docker) {
  fail("Docker", "not installed", "Install Docker Desktop: https://docs.docker.com/desktop/");
} else if (!sh("docker info")) {
  fail("Docker", "installed but not running", "Start Docker Desktop and wait for the whale to settle.");
} else {
  ok("Docker", docker.replace(/^Docker version /, ""));
}

const compose = sh("docker compose version");
compose
  ? ok("Compose", compose.replace(/^Docker Compose version /, ""))
  : fail("Compose", "docker compose v2 not available", "Update Docker Desktop; v1 `docker-compose` is not supported.");

const node = process.versions.node;
Number(node.split(".")[0]) >= 22
  ? ok("Node", node)
  : warn("Node", `${node} (want >= 22)`, "The front-ends target Node 22. Older versions may fail on `npm ci`.");

// Go and Rust are deliberately NOT checked: the backend builds inside
// containers, so a host toolchain is not required.

// ── Env files ────────────────────────────────────────────────────────
const envFiles = [
  "api/.env",
  "channels/finance/.env",
  "channels/sports/.env",
  "channels/rss/.env",
  "channels/fantasy/.env",
  "desktop/.env",
];
const missing = envFiles.filter((f) => !existsSync(path.join(ROOT, f)));
missing.length === 0
  ? ok("Env files", `${envFiles.length} present`)
  : fail("Env files", `${missing.length} missing: ${missing.join(", ")}`, "Run: make setup");

existsSync(path.join(ROOT, "secrets/predictions.docker.env"))
  ? ok("Predictions", "Kalshi key present")
  : warn("Predictions", "no Kalshi key (that service stays off)", "Optional. Run `make kalshi-key` if you need it.");

// ── Ports ────────────────────────────────────────────────────────────
// Only flag a port if something ELSE holds it. Our own containers holding
// it is the normal state during `make up`, so check container names first.
const ours = new Set(
  (sh('docker ps --format "{{.Names}}"') || "").split("\n").filter(Boolean),
);
const PORTS = [
  [5432, "postgres", "scrollr-postgres"],
  [6379, "redis", "scrollr-redis"],
  [18080, "core-api", "scrollr-core"],
  [8084, "fantasy-api", "scrollr-fantasy-api"],
  [3001, "finance", "scrollr-finance-svc"],
  [3002, "sports", "scrollr-sports-svc"],
  [3004, "rss", "scrollr-rss-svc"],
];

const inUse = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e) => resolve(e.code === "EADDRINUSE"));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });

const conflicts = [];
for (const [port, label, container] of PORTS) {
  if ((await inUse(port)) && !ours.has(container)) conflicts.push(`${port} (${label})`);
}
conflicts.length === 0
  ? ok("Ports", "all free or held by our own containers")
  : warn(
      "Ports",
      `in use by something else: ${conflicts.join(", ")}`,
      "Stop whatever holds them, or expect those services to fail to bind.",
    );

// ── Report ───────────────────────────────────────────────────────────
const failed = results.filter((r) => r.level === "fail");
const warned = results.filter((r) => r.level === "warn");

if (!QUIET || failed.length) {
  const mark = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };
  console.log("");
  for (const r of results) {
    console.log(`${mark[r.level]} ${r.name.padEnd(12)} ${r.detail}`);
    if (r.fix && r.level !== "ok") console.log(`${" ".repeat(21)}-> ${r.fix}`);
  }
  console.log("");
}

if (failed.length) {
  console.error(`doctor: ${failed.length} blocking problem(s) above.\n`);
  process.exit(1);
}
if (!QUIET && warned.length) console.log(`doctor: ok, with ${warned.length} warning(s).\n`);
else if (!QUIET) console.log("doctor: all good.\n");
