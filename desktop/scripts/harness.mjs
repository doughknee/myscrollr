/**
 * Shared Playwright shell for the verify-*.mjs preview-harness scripts:
 * screenshot dir, pass/fail bookkeeping, console watching, page setup.
 */
import { mkdirSync } from "node:fs";

export const OUT = process.env.UI_REVIEW_OUT ?? "ui-review-out";
mkdirSync(OUT, { recursive: true });

let failures = 0;
export function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

// Known-benign in every browser-only harness: asset 404s and the Tauri
// pref-store fallback (no desktop shell in a plain browser). Per-script
// extras (mock/IPC noise) come in via `extraBenign` so one harness's noise
// doesn't mask another's regression.
const benign = /Failed to load resource|Store write failed/;

export function watchConsole(page, consoleErrors, extraBenign) {
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() !== "error") return;
    if (benign.test(text) || extraBenign?.test(text)) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
}

/** newPage bound to a preview URL and its "rendered" selector. */
export function pageFactory(base, readySelector, extraBenign) {
  return async (browser, width, height, query = "") => {
    const page = await browser.newPage({ viewport: { width, height } });
    const consoleErrors = [];
    watchConsole(page, consoleErrors, extraBenign);
    await page.goto(`${base}${query}`, { waitUntil: "networkidle" });
    await page.waitForSelector(readySelector);
    return { page, consoleErrors };
  };
}

export async function finish(browser) {
  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
