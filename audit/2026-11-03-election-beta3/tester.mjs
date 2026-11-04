// Run from any directory with Node 22+, Docker Desktop and Edge on Windows.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../../desktop");
const requireDesktop = createRequire(path.join(desktop, "package.json"));
const state = path.join(tmpdir(), "scrollr-election-tester");
const publicKeys = path.join(state, "jwks");
const warm = { api: "http://127.0.0.1:18439", web: "http://127.0.0.1:19439" };
const fresh = { api: "http://127.0.0.1:18440", web: "http://127.0.0.1:19440" };
const sub = "beta3-local-tester";
const check = process.argv.includes("--check");
mkdirSync(publicKeys, { recursive: true });

function compose(args, input, capture = false) {
  return execFileSync(
    "docker",
    ["compose", "-p", "scrollr-election-tester", "-f", path.join(here, "compose.yaml"), ...args],
    {
      env: { ...process.env, ELECTION_TEST_KEYS: publicKeys },
      input,
      encoding: "utf8",
      stdio: [input ? "pipe" : "inherit", capture ? "pipe" : "inherit", "inherit"],
    },
  );
}

function replay(phase) {
  if (!["waiting", "first", "correction", "delayed", "called", "disputed", "reset"].includes(phase))
    throw Error("Unknown replay phase.");
  compose(
    ["exec", "-T", "db", "psql", "-X", "-U", "postgres", "-d", "scrollr_preview", "-v", "phase=" + phase],
    readFileSync(path.join(here, "replay.sql")),
  );
}

async function requireFreeWebPort() {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => {
    probe.once("error", () =>
      reject(Error("Port 19440 is in use. Close the existing tester window before starting another.")),
    );
    probe.listen(19440, "127.0.0.1", () => probe.close(resolve));
  });
}

function npm(args) {
  const windows = process.platform === "win32";
  // Only fixed, checked-in command arguments reach the Windows npm shim.
  execFileSync(windows ? "cmd.exe" : "npm", windows ? ["/d", "/c", "npm", ...args] : args, {
    cwd: desktop,
    stdio: "inherit",
  });
}

function ensurePackages() {
  const has = (name) => existsSync(path.join(desktop, "node_modules", name, "package.json"));
  if (!has("vite") || !has("playwright")) npm(["ci"]);
  if (!has("motion-plus") || !has("motion-plus-dom")) {
    // Run the desktop's own license-aware, token-redacting bootstrap.
    npm(["run", "preweb"]);
    if (!has("motion-plus") || !has("motion-plus-dom"))
      throw Error(
        "The desktop Motion+ install is incomplete. Prepare the licensed desktop dependencies before starting the tester.",
      );
  }
}

function readSession(file) {
  try {
    const session = JSON.parse(readFileSync(file, "utf8"));
    if (session.userSub === sub && session.expiresAt > Date.now() + 120_000) return session;
  } catch {}
}

function mintSession() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: "beta3-local", use: "sig" };
  // Only the public half is mounted into the JWKS container.
  writeFileSync(path.join(publicKeys, "jwks.json"), JSON.stringify({ keys: [jwk] }));
  const exp = Math.floor(Date.now() / 1000) + 86_400;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content =
    encode({ alg: "RS256", kid: jwk.kid }) +
    "." +
    encode({ sub, iss: "http://jwks", aud: fresh.api, exp, roles: [] });
  const jwt = content + "." + sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url");
  return { accessToken: jwt, expiresAt: exp * 1000, refreshToken: null, userSub: sub };
}

async function verified(api, session) {
  if (!session) return false;
  try {
    const response = await fetch(api + "/users/me/widgets?preview=elections", {
      headers: { Authorization: "Bearer " + session.accessToken },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok && Array.isArray((await response.json()).widgets);
  } catch {
    return false;
  }
}

async function startWeb(mode) {
  // Vite's router plugin resolves generated paths from cwd. Isolate desktop
  // endpoints, analytics and auth even on a machine with a configured .env.
  process.chdir(desktop);
  Object.assign(process.env, {
    VITE_API_URL: fresh.api,
    VITE_LOGTO_RESOURCE: fresh.api,
    VITE_AUTH_ENDPOINT: fresh.api,
    VITE_LOGTO_APP_ID: "election-preview",
    VITE_DEMO: "0",
    VITE_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
  });
  const vitePath = path.join(
    path.dirname(requireDesktop.resolve("vite/package.json")),
    "dist/node/index.js",
  );
  const { createServer } = await import(pathToFileURL(vitePath).href);
  const server = await createServer({
    root: desktop,
    plugins: [
      {
        name: "private-election-test-mode",
        configureServer(vite) {
          vite.middlewares.use("/__election_tester_mode", (_req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ project: "scrollr-election-tester", mode }));
          });
        },
      },
    ],
    server: { host: "127.0.0.1", port: 19440, strictPort: true },
  });
  await server.listen();
  return server;
}

async function run() {
  if (process.argv.includes("--stop")) {
    compose(["--profile", "live", "stop"]);
    return;
  }
  const phase = process.argv.find((a) => a.startsWith("--phase="));
  if (phase) {
    const mode = await fetch(fresh.web + "/__election_tester_mode", {
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (mode?.project !== "scrollr-election-tester" || mode.mode !== "replay")
      throw Error(
        "Open --fresh at 127.0.0.1:19440 before changing phases. The currently running review stack on 19439 and live mode use a different source.",
      );
    console.log("Applying fictional replay phase to the private tester at " + fresh.web);
    replay(phase.slice("--phase=".length));
    return;
  }
  ensurePackages();
  let session = readSession(path.join(tmpdir(), "scrollr-election-beta3-local/tester.json"));
  let endpoints = warm;
  const live = process.argv.includes("--live");
  let server,
    browser,
    runningWorker = false;
  try {
    // Verify the real local issuer through both the API and the Vite proxy.
    // Never install this credential into an existing personal browser profile.
    if (
      live ||
      process.argv.includes("--fresh") ||
      !((await verified(warm.api, session)) && (await verified(warm.web + "/__api", session)))
    ) {
      endpoints = fresh;
      await requireFreeWebPort();
      session = mintSession();
      compose(["--profile", "live", "stop", "elections"]);
      compose(["up", "-d", "--force-recreate", "core"]);
      // The regular JWT middleware checks suspension after signature and
      // audience. Seed only this synthetic account in the private Redis.
      compose([
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "SET",
        "auth:account-access:" + sub,
        "active",
        "EX",
        "86400",
      ]);
      console.log("Waiting for the private core build and database migrations…");
      const start = Date.now();
      let attempts = 0;
      while (!(await verified(fresh.api, session))) {
        if (
          ++attempts % 10 === 0 &&
          compose(["ps", "--all", "--status", "exited", "--services", "core"], undefined, true).trim() ===
            "core"
        ) {
          throw Error("Private core exited during startup. Run this launcher with --logs.");
        }
        if (Date.now() - start > 600_000)
          throw Error("Core did not become ready within ten minutes. Run this launcher with --logs.");
        await sleep(1_000);
      }
      if (live) {
        replay("reset");
        compose(["--profile", "live", "up", "-d", "--build", "elections"]);
        runningWorker = true;
        console.log("Using civicAPI in the private tester. A provider outage will show delayed data.");
      } else {
        replay("first");
        console.log(
          "Using a fictional QA replay: Preview A and Preview B. See TESTING.md for additional phases.",
        );
      }
      server = await startWeb(live ? "live" : "replay");
      if (!(await verified(fresh.web + "/__api", session)))
        throw Error("Vite proxy did not reach the isolated API.");
    }
    const catalog = await fetch(endpoints.api + "/catalog?preview=elections", { redirect: "error" }).then(
      (r) => r.json(),
    );
    if (!catalog.widgets.some((w) => w.id === "elections"))
      throw Error("Private core did not offer Election Results.");
    const { chromium } = requireDesktop("playwright");
    browser = await chromium.launch({
      headless: check,
      ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    });
    const ctx = await browser.newContext();
    await ctx.addInitScript(
      ({ origin, auth }) => {
        if (location.origin !== origin) return;
        localStorage.setItem("tauri-store:scrollr.json:scrollr:store-migrated", "true");
        localStorage.setItem("tauri-store:scrollr.json:scrollr:auth", JSON.stringify(auth));
      },
      { origin: endpoints.web, auth: session },
    );
    const page = await ctx.newPage();
    const dash = page.waitForResponse(
      (r) => r.url().startsWith(endpoints.web + "/__api/dashboard") && r.status() === 200,
      { timeout: 45_000 },
    );
    await Promise.all([dash, page.goto(endpoints.web + "/web.html")]);
    console.log("Signed-in Election Results tester ready at " + endpoints.web + "/web.html");
    if (!check)
      await new Promise((resolve) => {
        page.once("close", resolve);
        browser.once("disconnected", resolve);
      });
  } finally {
    await browser?.close();
    await server?.close();
    if (runningWorker) compose(["--profile", "live", "stop", "elections"]);
  }
}
try {
  if (process.argv.includes("--logs")) compose(["logs", "--tail", "80", "core"]);
  else await run();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
