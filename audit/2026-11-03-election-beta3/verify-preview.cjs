// Run against this checkout's disposable local beta stack. No production URL overrides.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const desktop = path.resolve(__dirname, "../../desktop");
const { chromium } = require(require.resolve("playwright", { paths: [desktop] }));
const folder = path.join(os.tmpdir(), "scrollr-election-beta3-local");
const origin = "http://127.0.0.1:19439";
const replay = fs.readFileSync(path.join(__dirname, "replay.sql"), "utf8");
const testWriter = process.argv.includes("--writer");

function phase(name, notify = false) {
  if (testWriter && notify && (name === "first" || name === "correction")) {
    execFileSync("docker", ["exec",
      "-e", "TEST_DATABASE_URL=postgres://postgres@scrollr-election-beta3-pg/scrollr_preview",
      "-e", "TEST_REDIS_URL=redis://scrollr-election-beta3-redis/",
      "-e", "ELECTION_REPLAY_PHASE=" + name, "scrollr-election-beta3-rust",
      "cargo", "test", "--locked", "replay_private_preview", "--", "--ignored", "--nocapture"], { stdio: "inherit" });
    return;
  }
  execFileSync("docker", ["exec", "-i", "scrollr-election-beta3-pg", "psql", "-X", "-U", "postgres",
    "-d", "scrollr_preview", "-v", "phase=" + name], { input: replay });
  if (notify) {
    const event = { data: [{ action: "update", record: {}, changes: {}, metadata: { table_name: "election_results" } }] };
    execFileSync("docker", ["exec", "-i", "scrollr-election-beta3-redis", "redis-cli", "-x",
      "PUBLISH", "cdc:elections:87476"], { input: JSON.stringify(event) });
  }
}

async function verify() {
  const session = JSON.parse(fs.readFileSync(path.join(folder, "tester.json"), "utf8"));
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(({ origin, session }) => {
      if (location.origin === origin) {
        localStorage.setItem("tauri-store:scrollr.json:scrollr:store-migrated", "true");
        localStorage.setItem("tauri-store:scrollr.json:scrollr:auth", JSON.stringify(session));
      }
    }, { origin, session });
    await page.goto(origin + "/web.html");
    const main = page.frameLocator("iframe.main");
    const ticker = page.frameLocator("iframe.ticker");
    // A warm tester can already have the widget installed.
    await main.getByRole("button", { name: "Home", exact: true }).first().waitFor();
    const entry = main.getByRole("button", { name: "Election Results", exact: true });
    if (await entry.count()) await entry.first().click();
    else {
      await main.getByRole("button", { name: /pages on your bar used/ }).click();
      await main.locator("input").first().fill("Election");
      await main.getByRole("button", { name: "Add Election Results" }).click();
    }
    await main.getByRole("searchbox").fill("Tennessee");
    const follow = main.getByRole("button", { name: "Follow Tennessee Governor", exact: true });
    const unfollow = main.getByRole("button", { name: "Unfollow Tennessee Governor" });
    if (await unfollow.count()) await unfollow.click();
    await follow.waitFor();
    await follow.click();
    await unfollow.waitFor();
    phase("first", true);
    const article = main.getByRole("article");
    await article.getByText("Preview A leads by 40 votes").waitFor({ timeout: 45_000 });
    const raceButton = ticker.locator("[data-race-id='87476']").first();
    await raceButton.waitFor({ timeout: 35_000 });
    const initial = await raceButton.boundingBox();
    assert(initial && initial.width > 0);
    await page.screenshot({ path: path.join(folder, "pages.png") });
    const start = Date.now();
    phase("correction", true);
    await article.getByText("Preview B leads by 30 votes").waitFor({ timeout: 10_000 });
    console.log("SSE correction visible after", Date.now() - start, "ms");
    // Test the missed-event fallback without navigation or a simulated push.
    phase("delayed");
    await article.getByText(/Updates delayed/).waitFor({ timeout: 65_000 });
    assert.match(await article.innerText(), /Preview B leads by 30 votes/);
    // Change the same saved preference the native ticker consumes across windows.
    await page.evaluate(() => {
      const key = "tauri-store:scrollr.json:scrollr:settings";
      const prefs = JSON.parse(localStorage.getItem(key) ?? "{}");
      prefs.ticker = { ...prefs.ticker, scrollMode: "continuous" };
      localStorage.setItem(key, JSON.stringify(prefs));
    });
    const chip = ticker.locator("[data-race-id='87476']:not([data-chip])").first();
    await chip.waitFor({ timeout: 40_000 });
    const before = await chip.boundingBox();
    phase("called", true);
    await article.getByText("civicAPI calls it for Preview B").waitFor({ timeout: 10_000 });
    await chip.filter({ hasText: "civicAPI calls it for Preview B" }).waitFor({ timeout: 12_000 });
    const after = await chip.boundingBox();
    assert.equal(after.width, before.width);
    await page.screenshot({ path: path.join(folder, "continuous.png") });
    await unfollow.click();
    await article.waitFor({ state: "detached" });
    await chip.waitFor({ state: "detached", timeout: 35_000 });
    phase("first");
    await follow.click();
    await article.getByText("Preview A leads by 40 votes").waitFor({ timeout: 40_000 });
    console.log("Follow, correction, delayed fallback, Pages, Continuous, call, unfollow and refollow passed.");
  } finally {
    await browser.close();
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
