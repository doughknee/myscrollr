#!/usr/bin/env node
/**
 * Renders `make help` by parsing the Makefile's `##<group>: description`
 * annotations.
 *
 * This was an inline awk one-liner. On Windows there is no awk, and GNU
 * make exec'd it directly rather than through SHELL, so help died with
 * `CreateProcess(NULL, awk ...)`. Node is already required by `make setup`
 * and `make doctor`, so using it here costs nothing and removes a tool
 * dependency that only existed on Unix.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(path.join(ROOT, "Makefile"), "utf8");

// Colour only when attached to a terminal, so piping `make help` stays clean.
const tty = process.stdout.isTTY;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const cyan = (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s);

const groups = new Map();
for (const line of src.split("\n")) {
  const m = line.match(/^([a-zA-Z_-]+):.*?##([a-z]+):\s*(.*)$/);
  if (!m) continue;
  const [, target, group, desc] = m;
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push({ target, desc });
}

const out = [];
out.push("");
out.push("  MyScrollr - local development");
out.push("");
for (const [group, targets] of groups) {
  out.push(bold(`  ${group.toUpperCase()}`));
  for (const { target, desc } of targets) {
    out.push(`    ${cyan(target.padEnd(14))} ${desc}`);
  }
}
out.push("");
out.push("  First time?  make setup  &&  make up");
out.push("");
out.push("  Ports  core 18080 | fantasy 8084 | postgres 5432 | redis 6379");
out.push("         finance 3001 | sports 3002 | rss 3004 | predictions 3005");
out.push("         web 3000 and the desktop app run natively, not in Docker");
out.push("");
console.log(out.join("\n"));
