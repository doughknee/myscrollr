import { test, expect } from "@playwright/test";
import { installTickerAudit } from "./audit";
import { swapsWhileVisible, type AuditEntry } from "../../src/dev/tickerIdentity";
import { openShim } from "./shim";

// Deterministic: a chip that swaps on screen is a bug, not flake.
test.describe.configure({ retries: 0 });

const RUN_MS = 30_000;
const PERTURB_EVERY_MS = 5_000;

// Runs inside the ticker window through the dev command bus (`qc` is the
// app's QueryClient). Alternates the sports pool between the full fixture
// and the fixture minus its first game: what a refetch does when a final
// ages out of the horizon or a new game enters. Every residue class
// shifts, so a slot that recomputes its membership from the live pool
// (the bug PR #339 fixed) flips what it shows with nobody looking away;
// a slot frozen by the RotationMemo holds until its own turn advances.
const PERTURB = `
  const k = ["dashboard"];
  const d = qc.getQueryData(k);
  window.__fullSports ??= d.data.sports;
  const full = window.__fullSports;
  const next = d.data.sports.length === full.length ? full.slice(1) : full;
  qc.setQueryData(k, { ...d, data: { ...d.data, sports: next } });
  return next.length;
`;

test("a rotating slot only changes what it shows while off screen", async ({ page }) => {
  test.setTimeout(RUN_MS + 30_000);
  await page.addInitScript(installTickerAudit);
  // Fastest preset, so 30 s holds several slot turns.
  await openShim(page, "?speed=80");

  const sizes: number[] = [];
  for (let t = PERTURB_EVERY_MS; t <= RUN_MS; t += PERTURB_EVERY_MS) {
    await page.waitForTimeout(PERTURB_EVERY_MS);
    const res = await page.request.post("/__dev/cmd", {
      data: { window: "ticker", code: PERTURB, timeout: 4000 },
    });
    const body = (await res.json()) as { ok: boolean; value?: number; error?: string };
    expect(body.ok, body.error).toBe(true);
    sizes.push(body.value!);
  }
  // The pool really changed under the bar.
  expect(new Set(sizes).size).toBe(2);

  const entries = await page.evaluate(() => {
    const w = window as unknown as { __tickerAudit: AuditEntry[] };
    const buf = w.__tickerAudit;
    w.__tickerAudit = [];
    return buf;
  });
  // The audit saw the bar at all: rotating slots exist and something moved.
  expect(entries.length, "no mutations recorded — did the audit install?").toBeGreaterThan(0);

  const swaps = swapsWhileVisible(entries);
  expect(swaps, JSON.stringify(swaps.slice(0, 5), null, 2)).toEqual([]);
});
