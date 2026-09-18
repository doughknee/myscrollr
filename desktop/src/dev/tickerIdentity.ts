/**
 * Rule-6 classifier for the browser audit (SCROLLR-227). Ported from
 * scripts/dev/rel234-classify.mjs, which was validated against 6,590 real
 * mutations on PR #339; the stripping rules are the point, do not tidy them.
 *
 * A rotating slot keyed `${prefix}-slot-i` shows a DIFFERENT item without
 * its DOM key changing, so React updates it through characterData
 * mutations on the existing node rather than a childList swap. So per
 * chip node we track the chip's full text over time and diff consecutive
 * snapshots, stripping digits/currency/percent/time noise, to tell an
 * identity swap (team names, symbol, headline changed) from an allowed
 * in-place value repaint (score, price, timer, clock digits).
 */

/** What the injected audit (e2e/ticker/audit.ts) records per mutation. */
export interface AuditEntry {
  t: number;
  type: "characterData" | "childList" | "attributes";
  slot: string | null;
  nodeId: number;
  kind: string;
  before: string;
  after: string;
  chipText: string;
  visibleWhileChanging: boolean;
}

export interface Swap {
  t: number;
  slot: string | null;
  kind: string;
  before: string;
  after: string;
}

/**
 * Strip digits, %, +/-, $, decimal points, colons (times), and whitespace
 * runs, leaving the "identity" text (team names, symbol letters, headline
 * words). Two snapshots with the same identity after stripping are a value
 * repaint; different identity is a swap.
 */
export function identity(s: string | null | undefined): string {
  return (s || "")
    // Ordinal ranks (1st, 22nd, ...) before stripping bare digits, so the
    // "st/nd/rd/th" suffix doesn't survive as leftover identity text. No
    // word-boundary requirement: chip textContent has no separators
    // between fields ("1st85-58...RD2nd80...").
    .replace(/\d+(st|nd|rd|th)/gi, "")
    // Every remaining digit and number-adjacent sign/punctuation mark,
    // one character at a time.
    .replace(/[\d+\-−.,:%▲▼☀⛅☾$—]/g, "")
    // A standings row's units (run differential "RD") and the "no table
    // for this league" placeholder are values, not identity (REL-235).
    .replace(/RD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every identity change (or slot re-key) that happened while some instance
 * of the chip overlapped the container: the rule-6 violations. Keyed by the
 * chip's DOM-node identity (nodeId), never by slot or kind, so two
 * concurrently-live chips are never diffed against each other.
 */
export function swapsWhileVisible(entries: AuditEntry[]): Swap[] {
  const lastByNode = new Map<number, { text: string; identity: string }>();
  const swaps: Swap[] = [];
  for (const e of entries) {
    if (e.type === "attributes") {
      // The slot key itself was reassigned to a different DOM node.
      if (e.visibleWhileChanging) {
        swaps.push({ t: e.t, slot: e.slot, kind: e.kind, before: `slot="${e.before}"`, after: `slot="${e.after}"` });
      }
      continue;
    }
    const prev = lastByNode.get(e.nodeId);
    const curText = e.chipText || "";
    const curIdentity = identity(curText);
    if (prev && prev.identity !== curIdentity && e.visibleWhileChanging) {
      swaps.push({ t: e.t, slot: e.slot, kind: e.kind, before: prev.text, after: curText });
    }
    lastByNode.set(e.nodeId, { text: curText, identity: curIdentity });
  }
  return swaps;
}
