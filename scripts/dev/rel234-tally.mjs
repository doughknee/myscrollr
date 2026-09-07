// REL-234 harness: read one drain's JSON array from stdin, append it (as a
// compact single-line JSON record with a timestamp+phase wrapper) to the
// given JSONL file, and print a one-line summary with a violation count.
//
// A "violation" is a structural (childList) mutation on a chip that was
// visible (any instance overlapping the container) at the moment it
// changed, where the text actually identifies a different item -- not
// just a field repaint (score, price, clock digits).
import { appendFileSync, readFileSync } from "node:fs";

const [, , jsonlPath, phase] = process.argv;
const raw = readFileSync(0, "utf8");
let entries;
try {
  entries = JSON.parse(raw);
} catch {
  console.log(`[${phase}] drain: unparseable response: ${raw.slice(0, 200)}`);
  process.exit(0);
}
if (!Array.isArray(entries)) entries = [];

const isViolation = (e) =>
  e.type === "childList" &&
  e.visibleWhileChanging === true &&
  e.before &&
  e.after &&
  e.before.trim() !== e.after.trim();

const violations = entries.filter(isViolation);
const record = { drainedAt: new Date().toISOString(), phase, count: entries.length, violations: violations.length, entries };
appendFileSync(jsonlPath, JSON.stringify(record) + "\n");

console.log(
  `[${phase}] drain: ${entries.length} mutations, ${violations.length} flagged` +
    (violations.length ? ` -- ${violations.slice(0, 3).map((v) => `${v.kind}/${v.slot}: "${v.before}" -> "${v.after}"`).join(" | ")}` : ""),
);
