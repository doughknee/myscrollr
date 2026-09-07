// REL-234: offline classifier over the drained JSONL.
//
// The live per-drain tally only flagged childList mutations with differing
// text. That misses the real bug: a slot keyed `${prefix}-slot-i}` shows a
// DIFFERENT item without its DOM key changing, so React updates it via
// characterData mutations on the existing node, not a childList swap.
// So here we track, per slot key, the chip's full text over time and diff
// consecutive snapshots -- stripping digits/currency/percent/time noise --
// to tell an identity swap (team names, symbol, headline changed) from an
// allowed in-place value repaint (score, price, timer, clock digits).
import { readFileSync } from "node:fs";

const [, , ...files] = process.argv;
if (files.length === 0) {
  console.error("usage: rel234-classify.mjs <jsonl files...>");
  process.exit(2);
}

// Strip digits, %, +/-, $, decimal points, colons (times), and whitespace
// runs, leaving the "identity" text (team names, symbol letters, headline
// words). Two snapshots with the same identity after stripping are a value
// repaint; different identity is a swap.
const identity = (s) =>
  (s || "")
    // Ordinal ranks (1st, 22nd, ...) before stripping bare digits, so the
    // "st/nd/rd/th" suffix doesn't survive as leftover identity text. No
    // word-boundary requirement: chip textContent has no separators
    // between fields ("1st85-58...RD2nd80...").
    .replace(/\d+(st|nd|rd|th)/gi, "")
    // Every remaining digit and number-adjacent sign/punctuation mark,
    // one character at a time (compound tokens like "73-71−14" don't
    // need to be matched as a unit -- just erased character by character).
    .replace(/[\d+\-−.,:%▲▼☀⛅☾$—]/g, "")
    // A standings row's units (run differential "RD") and the "no table
    // for this league" placeholder are values, not identity -- this is
    // REL-235 (standings flap), tracked separately from REL-234.
    .replace(/RD/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Keyed by the chip's own DOM-node identity (nodeId, from the install
// script's WeakMap) -- NOT by slot or kind. Two concurrently-live chips
// must never be diffed against each other; nodeId guarantees that even
// for fixed (non-slotted) chips that share no data-rotate-slot.
const lastByNode = new Map();
const events = { total: 0, byKind: {} };
const swaps = [];
const repaints = { byField: {} };
const remounts = [];

function note(kind, bucket, extra) {
  events.byKind[kind] ??= { total: 0 };
  events.byKind[kind][bucket] = (events.byKind[kind][bucket] ?? 0) + 1;
  events.byKind[kind].total++;
}

for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const rec = JSON.parse(line);
    for (const e of rec.entries ?? []) {
      events.total++;
      if (e.type === "attributes") {
        // The slot key itself was reassigned to a different DOM node
        // (or vice versa) -- always worth surfacing on its own.
        note(e.kind, e.visibleWhileChanging ? "rekey-visible" : "rekey-hidden");
        if (e.visibleWhileChanging) {
          swaps.push({ t: e.t, phase: rec.phase, slot: e.slot, kind: e.kind, before: `slot="${e.before}"`, after: `slot="${e.after}"` });
        }
        continue;
      }
      // Prefer the DOM-node identity (nodeId); fall back to the slot key,
      // then kind, for captures taken before the install script tracked
      // nodeId -- best-effort only for those older files.
      const key = e.nodeId ?? e.slot ?? `${e.kind}:fixed`;
      const prev = lastByNode.get(key);
      const curText = e.chipText || "";
      const curIdentity = identity(curText);

      if (e.type === "childList" && e.before && e.after) {
        // Structural replace -- a re-key/remount, or a slot appearing for
        // the first time (no prior snapshot => not a remount, just mount).
        if (prev) {
          note(e.kind, e.visibleWhileChanging ? "remount-visible" : "remount-hidden");
          if (e.visibleWhileChanging) {
            remounts.push({ t: e.t, phase: rec.phase, slot: e.slot, kind: e.kind, before: e.before, after: e.after });
          }
        }
      }

      if (prev && prev.identity !== curIdentity) {
        // The chip's non-numeric content changed -- a different item.
        note(e.kind, e.visibleWhileChanging ? "swap-visible" : "swap-hidden");
        if (e.visibleWhileChanging) {
          swaps.push({
            t: e.t,
            phase: rec.phase,
            slot: e.slot,
            kind: e.kind,
            before: prev.text,
            after: curText,
          });
        }
      } else if (prev && prev.text !== curText) {
        note(e.kind, e.visibleWhileChanging ? "repaint-visible" : "repaint-hidden");
      }

      lastByNode.set(key, { text: curText, identity: curIdentity, t: e.t });
    }
  }
}

console.log(JSON.stringify({ totalMutations: events.total, byKind: events.byKind }, null, 2));
console.log("\n--- SWAPS WHILE VISIBLE (rule 6 violations) ---");
for (const s of swaps.slice(0, 40)) {
  console.log(`[${s.phase}] ${s.kind} ${s.slot}: "${s.before}" -> "${s.after}"`);
}
console.log(`\ntotal swap-while-visible events: ${swaps.length}`);
console.log(`total remount-while-visible events: ${remounts.length}`);
for (const r of remounts.slice(0, 20)) {
  console.log(`[${r.phase}] REMOUNT ${r.kind} ${r.slot}: "${r.before}" -> "${r.after}"`);
}
